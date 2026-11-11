/**
 * 3D Autonomous Research Neural Nexus & Knowledge Graph
 * Pure WebGL / Canvas implementation with zero external dependencies.
 * Designed for 60fps performance, battery efficiency, and mobile responsiveness.
 */

(function () {
  'use strict';

  function initNeuralNexus3D() {
    var container = document.getElementById('neural-nexus-3d');
    if (!container) return;

    var canvas = document.createElement('canvas');
    canvas.className = 'neural-nexus-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    var animId = null;
    var isVisible = true;
    var rotX = 0.2;
    var rotY = 0.3;
    var targetRotX = 0.2;
    var targetRotY = 0.3;
    var time = 0;

    // 3D Research Nodes
    var nodes = [
      { id: 'core', label: 'Forensic Core', x: 0, y: 0, z: 0, radius: 18, color: '#34d399', isCore: true },
      { id: 'filings', label: 'Filing Ingestion', x: -85, y: -45, z: 50, radius: 10, color: '#60a5fa' },
      { id: 'sentiment', label: 'Transcript Signals', x: 80, y: -50, z: -40, radius: 9, color: '#a78bfa' },
      { id: 'verifier', label: 'Hypothesis Verifier', x: 95, y: 40, z: 45, radius: 11, color: '#38bdf8' },
      { id: 'governance', label: 'Governance Audit', x: -75, y: 55, z: -35, radius: 9, color: '#f472b6' },
      { id: 'watchlist', label: 'Live Telemetry', x: 0, y: -85, z: -20, radius: 8, color: '#fbbf24' },
      { id: 'evidence', label: 'Evidence Calibration', x: 10, y: 80, z: 25, radius: 10, color: '#4ade80' }
    ];

    // Node edges
    var edges = [
      [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
      [1, 4], [2, 3], [5, 2], [6, 3]
    ];

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var width = container.clientWidth || 320;
      var height = container.clientHeight || 280;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    window.addEventListener('resize', resize);
    resize();

    function onPointerMove(e) {
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      var normX = ((clientX - rect.left) / rect.width) * 2 - 1;
      var normY = ((clientY - rect.top) / rect.height) * 2 - 1;

      targetRotY = normX * 0.55;
      targetRotX = -normY * 0.35;
    }

    window.addEventListener('mousemove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: true });

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        isVisible = entries[0].isIntersecting;
        if (isVisible && !animId) {
          loop();
        }
      }, { threshold: 0.1 });
      observer.observe(canvas);
    }

    function loop() {
      if (!isVisible) {
        animId = null;
        return;
      }

      time += 0.02;
      rotX += (targetRotX - rotX) * 0.08;
      rotY += (targetRotY - rotY) * 0.08;
      rotY += 0.006; // continuous gentle spin

      render();
      animId = requestAnimationFrame(loop);
    }

    function render() {
      var width = parseFloat(canvas.style.width) || 320;
      var height = parseFloat(canvas.style.height) || 280;
      var cx = width / 2;
      var cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      var cosY = Math.cos(rotY);
      var sinY = Math.sin(rotY);
      var cosX = Math.cos(rotX);
      var sinX = Math.sin(rotX);
      var fov = 320;

      // Project nodes to 2D
      var projected = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        // Floating wave displacement
        var dy = n.isCore ? 0 : Math.sin(time * 2 + i) * 6;

        var x1 = n.x * cosY + n.z * sinY;
        var y1 = n.y + dy;
        var z1 = -n.x * sinY + n.z * cosY;

        var y2 = y1 * cosX - z1 * sinX;
        var z2 = y1 * sinX + z1 * cosX;

        var scale = fov / (fov + z2 + 150);
        projected.push({
          id: n.id,
          label: n.label,
          px: cx + x1 * scale,
          py: cy + y2 * scale,
          depth: z2,
          scale: scale,
          radius: n.radius * scale,
          color: n.color,
          isCore: n.isCore
        });
      }

      // Draw Edges (Pulsing connections)
      ctx.save();
      for (var e = 0; e < edges.length; e++) {
        var p1 = projected[edges[e][0]];
        var p2 = projected[edges[e][1]];
        if (!p1 || !p2) continue;

        var edgeAlpha = Math.max(0.12, Math.min(0.5, (p1.scale + p2.scale) * 0.3));
        ctx.strokeStyle = 'rgba(52, 211, 153, ' + edgeAlpha + ')';
        ctx.lineWidth = Math.max(0.8, 1.6 * ((p1.scale + p2.scale) / 2));
        ctx.beginPath();
        ctx.moveTo(p1.px, p1.py);
        ctx.lineTo(p2.px, p2.py);
        ctx.stroke();

        // Data pulse packet traversing the edge
        var pulseT = (time * 0.8 + e * 0.3) % 1;
        var pulseX = p1.px + (p2.px - p1.px) * pulseT;
        var pulseY = p1.py + (p2.py - p1.py) * pulseT;

        ctx.fillStyle = '#6ee7b7';
        ctx.beginPath();
        ctx.arc(pulseX, pulseY, 2 * p1.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Sort nodes by depth
      var sorted = projected.slice().sort(function (a, b) { return b.depth - a.depth; });

      // Draw Nodes
      for (var j = 0; j < sorted.length; j++) {
        var pt = sorted[j];
        if (pt.scale <= 0) continue;

        ctx.save();
        // Outer halo
        ctx.shadowColor = pt.color;
        ctx.shadowBlur = pt.isCore ? 28 * pt.scale : 14 * pt.scale;

        var grad = ctx.createRadialGradient(pt.px - pt.radius * 0.3, pt.py - pt.radius * 0.3, 1, pt.px, pt.py, pt.radius);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.4, pt.color);
        grad.addColorStop(1, 'rgba(15, 23, 42, 0.8)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, pt.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // Node label
        if (pt.scale > 0.82) {
          ctx.save();
          ctx.font = '10px Inter, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.textAlign = 'center';
          ctx.fillText(pt.label, pt.px, pt.py + pt.radius + 12);
          ctx.restore();
        }
      }
    }

    loop();
  }

  // 3D Card Tilt Interaction for Panels
  function initCardTilts() {
    var cards = document.querySelectorAll('.panel, .query-section, .demo-notice, .query-control');
    var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    cards.forEach(function (card) {
      card.addEventListener('mouseenter', function () {
        card.style.transition = 'transform 0.12s cubic-bezier(0.2, 0, 0, 1)';
      });

      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        var x = (e.clientX - rect.left) / rect.width;
        var y = (e.clientY - rect.top) / rect.height;

        var rotX = (0.5 - y) * 8;
        var rotY = (x - 0.5) * 8;

        card.style.transform = 'perspective(900px) rotateX(' + rotX.toFixed(2) + 'deg) rotateY(' + rotY.toFixed(2) + 'deg) scale3d(1.015, 1.015, 1.015)';
        card.style.setProperty('--card-x', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--card-y', (y * 100).toFixed(1) + '%');
      });

      card.addEventListener('mouseleave', function () {
        card.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
        card.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initNeuralNexus3D();
      initCardTilts();
    });
  } else {
    initNeuralNexus3D();
    initCardTilts();
  }
})();
