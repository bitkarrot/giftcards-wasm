// Gift Cards Redeem Page — vanilla JS, CSP-safe
// Uses bridge (postMessage) instead of fetch (blocked by connect-src 'none')
(function() {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  var API_BASE = '/api/v1/ext/giftcards';
  function apiCall(method, path, body) {
    var fullPath = API_BASE + path;
    return window.LNbitsBridge.connect().then(function() {
      return window.LNbitsBridge.callApi(method, fullPath, body);
    });
  }

  // Extract token from URL: /ext/giftcards/redeem/{token}
  var pathParts = window.location.pathname.split('/');
  var token = '';
  for (var i = 0; i < pathParts.length; i++) {
    if (pathParts[i] === 'redeem' && i + 1 < pathParts.length) {
      token = pathParts[i + 1];
      break;
    }
  }

  if (!token) {
    $('redeem-loading').textContent = 'Invalid gift card link.';
    $('redeem-loading').className = 'error';
    return;
  }

  // Use bridge to get LNURL params (public endpoint)
  apiCall('GET', '/lnurl/' + token, null)
    .then(function(lnurlRes) {
      if (lnurlRes.detail || lnurlRes.error) {
        $('redeem-loading').textContent = lnurlRes.detail || lnurlRes.error;
        $('redeem-loading').className = 'error';
        return;
      }
      // Get public card info
      return apiCall('GET', '/cards/public/' + token, null)
        .then(function(card) {
          if (card.detail || card.error) {
            $('redeem-loading').textContent = card.detail || card.error;
            $('redeem-loading').className = 'error';
            return;
          }
          renderCard(card, lnurlRes);
        });
    })
    .catch(function(err) {
      $('redeem-loading').textContent = 'Error loading gift card: ' + (err.message || err);
      $('redeem-loading').className = 'error';
    });

  function renderCard(card, lnurlRes) {
    var container = $('redeem-container');
    var status = card.status || 'active';
    var statusClass = 'status-' + status;

    var html = '';
    html += '<h1>Gift Card</h1>';
    html += '<div class="amount">' + (card.amount || 0).toLocaleString() + ' sats</div>';

    if (card.senderName) html += '<div class="sender">From: ' + escapeHtml(card.senderName) + '</div>';
    if (card.recipientName) html += '<div class="sender">To: ' + escapeHtml(card.recipientName) + '</div>';

    html += '<span class="status-badge ' + statusClass + '">' + escapeHtml(status) + '</span>';

    if (card.message) {
      html += '<div class="message">' + escapeHtml(card.message) + '</div>';
    }

    if (status === 'active') {
      // Show LNURL-withdraw QR code
      var lnurl = lnurlRes.lnurl || ('LNURL' + token);
      html += '<div class="qr-container"><canvas id="redeem-qr"></canvas></div>';
      html += '<div class="instructions">Scan this QR code with a Lightning wallet to withdraw ' + (card.amount || 0) + ' sats.</div>';
    } else if (status === 'redeemed') {
      html += '<div class="instructions">This gift card has been redeemed.</div>';
    } else if (status === 'expired') {
      html += '<div class="instructions">This gift card has expired.</div>';
    }

    container.innerHTML = html;

    // Render QR code
    if (status === 'active') {
      setTimeout(function() {
        var canvas = $('redeem-qr');
        if (canvas && window.QRCode) {
          window.QRCode.toCanvas(canvas, lnurl, { width: 250 }, function() {});
        }
      }, 50);
    }
  }
})();
