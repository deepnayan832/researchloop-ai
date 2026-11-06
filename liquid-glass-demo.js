(function () {
  "use strict";

  var stage = document.getElementById("liquid-stage");
  var lens = document.getElementById("liquid-lens");
  var surface = document.getElementById("liquid-surface");
  var shapeToggle = document.getElementById("liquid-shape-toggle");
  var bars = document.getElementById("liquid-bars");
  if (!stage || !lens || !surface || !shapeToggle || !bars) return;

  var config = { shape: "circle", scale: 48, aberration: 14, bevelDepth: 37, frost: 0.4, tint: 0.12 };
  var offset = { x: 0, y: 0 };
  var drag = null;
  var currentBlobUrl = null;
  var renderVersion = 0;
  var prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var prefersReducedTransparency = window.matchMedia && window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
  var userAgent = navigator.userAgent || "";
  var safariLike = /Safari/.test(userAgent) && !/Chrome|Chromium|Edg|OPR/.test(userAgent);
  var supportsSvgBackdrop = typeof CSS !== "undefined" && CSS.supports &&
    (CSS.supports("backdrop-filter", "url(#liquid-test)") || CSS.supports("-webkit-backdrop-filter", "url(#liquid-test)"));
  var svgHost = document.createElement("span");
  svgHost.className = "liquid-demo__sr-only";
  svgHost.setAttribute("aria-hidden", "true");
  stage.appendChild(svgHost);

  for (var i = 0; i < 48; i += 1) {
    var bar = document.createElement("span");
    bar.setAttribute("aria-hidden", "true");
    bars.appendChild(bar);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function updatePosition() {
    lens.style.transform = "translate(calc(-50% + " + offset.x + "px), calc(-50% + " + offset.y + "px))";
  }

  function setShape(shape) {
    config.shape = shape;
    var isPill = shape === "pill";
    var width = isPill ? 320 : 200;
    var height = isPill ? 120 : 200;
    if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
      width = Math.min(width, stage.clientWidth * (isPill ? 0.78 : 0.62));
      if (isPill) height = Math.max(86, width * 0.375);
      else height = width;
    }
    lens.style.width = width + "px";
    lens.style.height = height + "px";
    surface.style.borderRadius = Math.round(height / 2) + "px";
    lens.style.borderRadius = Math.round(height / 2) + "px";
    offset.x = 0;
    offset.y = 0;
    updatePosition();
    shapeToggle.textContent = isPill ? "Switch to circle" : "Switch to pill";
    shapeToggle.setAttribute("aria-pressed", isPill ? "true" : "false");
    scheduleRender();
  }

  function sdRoundedBox(px, py, halfW, halfH, radius) {
    var qx = Math.abs(px) - halfW + radius;
    var qy = Math.abs(py) - halfH + radius;
    var outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    var inside = Math.min(Math.max(qx, qy), 0);
    return inside + outside - radius;
  }

  function bendFromDepth(x) {
    var u = 1 - clamp(x, 0, 1);
    var denom = Math.pow(1 - Math.pow(u, 4), 0.75);
    if (denom < 0.000001) return 0;
    var thetaI = Math.atan(Math.min(Math.pow(u, 3) / denom, 8));
    var sinT = Math.sin(thetaI) / 1.5;
    if (sinT >= 1) return Math.sin(thetaI);
    return Math.sin(thetaI - Math.asin(sinT));
  }

  function buildPhiTable(bevelPx) {
    var n = Math.max(1, Math.ceil(bevelPx));
    var phi = new Float32Array(n + 1);
    for (var d = 1; d <= n; d += 1) phi[d] = phi[d - 1] + bendFromDepth(d / n);
    return phi;
  }

  function samplePhi(phi, depth) {
    var max = phi.length - 1;
    if (depth <= 0) return phi[0];
    if (depth >= max) return phi[max];
    var index = Math.floor(depth);
    var fraction = depth - index;
    return phi[index] * (1 - fraction) + phi[index + 1] * fraction;
  }

  function computeDisplacement(options) {
    var dpr = options.dpr || 1;
    var gain = 1.35;
    var lightX = -0.55;
    var lightY = -0.85;
    var lightLength = Math.hypot(lightX, lightY) || 1;
    lightX /= lightLength;
    lightY /= lightLength;
    var width = Math.max(1, Math.round(options.width * dpr));
    var height = Math.max(1, Math.round(options.height * dpr));
    var halfW = width / 2;
    var halfH = height / 2;
    var radius = Math.min(options.radius * dpr, halfW, halfH);
    var bevel = Math.max(1, options.bevelDepth * dpr);
    var phi = buildPhiTable(bevel);
    var field = new Float32Array(width * height);

    for (var y = 0; y < height; y += 1) {
      var py = y - halfH + 0.5;
      for (var x = 0; x < width; x += 1) {
        var distance = sdRoundedBox(x - halfW + 0.5, py, halfW, halfH, radius);
        field[y * width + x] = distance > 0 ? 0 : samplePhi(phi, Math.min(bevel, -distance));
      }
    }

    var data = new Uint8ClampedArray(width * height * 4);
    for (var yy = 0; yy < height; yy += 1) {
      var pyy = yy - halfH + 0.5;
      for (var xx = 0; xx < width; xx += 1) {
        var pxx = xx - halfW + 0.5;
        var index = (yy * width + xx) << 2;
        var edgeDistance = sdRoundedBox(pxx, pyy, halfW, halfH, radius);
        if (edgeDistance > 0) {
          data[index] = 128;
          data[index + 1] = 128;
          data[index + 2] = 128;
          data[index + 3] = 0;
          continue;
        }

        var x0 = Math.max(0, xx - 1);
        var x1 = Math.min(width - 1, xx + 1);
        var y0 = Math.max(0, yy - 1);
        var y1 = Math.min(height - 1, yy + 1);
        var dPhiX = (field[yy * width + x1] - field[yy * width + x0]) / (x1 - x0 || 1);
        var dPhiY = (field[y1 * width + xx] - field[y0 * width + xx]) / (y1 - y0 || 1);
        var dx = clamp(dPhiX * gain, -1, 1);
        var dy = clamp(dPhiY * gain, -1, 1);
        var specular = 0;

        if (edgeDistance >= -bevel) {
          var gx = sdRoundedBox(pxx + 1, pyy, halfW, halfH, radius) - sdRoundedBox(pxx - 1, pyy, halfW, halfH, radius);
          var gy = sdRoundedBox(pxx, pyy + 1, halfW, halfH, radius) - sdRoundedBox(pxx, pyy - 1, halfW, halfH, radius);
          var length = Math.hypot(gx, gy) || 1;
          var dot = (gx / length) * lightX + (gy / length) * lightY;
          var rim = 1 - Math.min(1, -edgeDistance / bevel);
          specular = (Math.max(0, dot) + Math.max(0, -dot) * 0.35) * rim;
        }

        data[index] = 128 + dx * 127;
        data[index + 1] = 128 + dy * 127;
        data[index + 2] = Math.round(specular * 255);
        data[index + 3] = 255;
      }
    }
    return { data: data, width: width, height: height };
  }

  function generateMapUrl(options) {
    var result = computeDisplacement(options);
    var canvas = document.createElement("canvas");
    canvas.width = result.width;
    canvas.height = result.height;
    var context = canvas.getContext("2d");
    if (!context) return Promise.reject(new Error("Canvas 2D context unavailable"));
    var imageData = context.createImageData(result.width, result.height);
    imageData.data.set(result.data);
    context.putImageData(imageData, 0, 0);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error("Could not encode displacement map"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, "image/png");
    });
  }

  function buildFilterSvg(id, mapUrl, width, height) {
    var pad = Math.ceil(config.scale + config.aberration + 4);
    var px = (pad / Math.max(1, width)) * 100;
    var py = (pad / Math.max(1, height)) * 100;
    var region = 'x="-' + px.toFixed(3) + '%" y="-' + py.toFixed(3) + '%" width="' + (100 + 2 * px).toFixed(3) + '%" height="' + (100 + 2 * py).toFixed(3) + '%"';
    var map = '<feImage href="' + mapUrl + '" xlink:href="' + mapUrl + '" x="0" y="0" width="' + width + '" height="' + height + '" result="map" preserveAspectRatio="none"/>';
    function displace(amount, result) {
      return '<feDisplacementMap in="SourceGraphic" in2="map" scale="' + amount + '" xChannelSelector="R" yChannelSelector="G" result="' + result + '"/>';
    }
    var body;
    if (config.aberration <= 0) {
      body = displace(config.scale, "rgb");
    } else {
      body = displace(config.scale + config.aberration, "dispR") +
        '<feColorMatrix in="dispR" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red"/>' +
        displace(config.scale, "dispG") +
        '<feColorMatrix in="dispG" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green"/>' +
        displace(Math.max(0, config.scale - config.aberration), "dispB") +
        '<feColorMatrix in="dispB" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue"/>' +
        '<feBlend in="red" in2="green" mode="screen" result="rg"/>' +
        '<feBlend in="rg" in2="blue" mode="screen" result="rgb"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><filter id="' + id + '" color-interpolation-filters="sRGB" ' + region + '>' +
      map + body + '<feGaussianBlur in="rgb" stdDeviation="' + config.frost + '"/></filter></svg>';
  }

  function applyFallback() {
    var backdrop = prefersReducedTransparency ? "none" : "blur(20px) saturate(1.4)";
    surface.style.backgroundColor = prefersReducedTransparency ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.38)";
    surface.style.backdropFilter = backdrop;
    surface.style.webkitBackdropFilter = backdrop;
  }

  function renderLens() {
    var version = ++renderVersion;
    if (prefersReducedTransparency || safariLike || !supportsSvgBackdrop) {
      applyFallback();
      return;
    }
    var rect = surface.getBoundingClientRect();
    var width = Math.max(1, Math.round(rect.width));
    var height = Math.max(1, Math.round(rect.height));
    if (width < 2 || height < 2) return;

    generateMapUrl({
      width: width,
      height: height,
      radius: Math.min(height / 2, width / 2),
      bevelDepth: Math.min(config.bevelDepth, Math.min(width, height) / 2),
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    }).then(function (mapUrl) {
      if (version !== renderVersion) {
        URL.revokeObjectURL(mapUrl);
        return;
      }
      var id = "liquid-glass-" + width + "x" + height + "-" + version;
      svgHost.innerHTML = buildFilterSvg(id, mapUrl, width, height);
      var backdrop = "url(#" + id + ") blur(0.5px) saturate(1.85) brightness(1.02)";
      surface.style.backgroundColor = "rgba(255,255,255," + config.tint + ")";
      surface.style.backdropFilter = backdrop;
      surface.style.webkitBackdropFilter = backdrop;
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = mapUrl;
    }).catch(function () {
      applyFallback();
    });
  }

  var renderFrame = 0;
  function scheduleRender() {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(function () {
      renderFrame = 0;
      renderLens();
    });
  }

  function moveBy(dx, dy) {
    var halfW = lens.offsetWidth / 2;
    var halfH = lens.offsetHeight / 2;
    var maxX = Math.max(0, stage.clientWidth / 2 - halfW);
    var maxY = Math.max(0, stage.clientHeight / 2 - halfH);
    offset.x = clamp(offset.x + dx, -maxX, maxX);
    offset.y = clamp(offset.y + dy, -maxY, maxY);
    updatePosition();
  }

  lens.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
    lens.classList.add("is-dragging");
    if (!prefersReducedMotion) lens.style.scale = "1.04";
    if (lens.setPointerCapture) lens.setPointerCapture(event.pointerId);
  });

  lens.addEventListener("pointermove", function (event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    offset.x = drag.offsetX;
    offset.y = drag.offsetY;
    moveBy(dx, dy);
  });

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    drag = null;
    lens.classList.remove("is-dragging");
    lens.style.scale = "1";
  }
  lens.addEventListener("pointerup", endDrag);
  lens.addEventListener("pointercancel", endDrag);
  lens.addEventListener("lostpointercapture", endDrag);

  lens.addEventListener("keydown", function (event) {
    var step = event.shiftKey ? 28 : 12;
    if (event.key === "ArrowLeft") { moveBy(-step, 0); event.preventDefault(); }
    else if (event.key === "ArrowRight") { moveBy(step, 0); event.preventDefault(); }
    else if (event.key === "ArrowUp") { moveBy(0, -step); event.preventDefault(); }
    else if (event.key === "ArrowDown") { moveBy(0, step); event.preventDefault(); }
  });

  shapeToggle.addEventListener("click", function () {
    setShape(config.shape === "circle" ? "pill" : "circle");
  });

  if (typeof ResizeObserver !== "undefined") {
    var observer = new ResizeObserver(scheduleRender);
    observer.observe(surface);
    observer.observe(stage);
  } else {
    window.addEventListener("resize", scheduleRender);
  }

  setShape("circle");
  window.addEventListener("pagehide", function () {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  });
})();