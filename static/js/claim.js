// Gift Cards Claim Page — vanilla JS, CSP-safe
// Uses bridge (postMessage) instead of fetch (blocked by connect-src 'none')
(function() {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function apiCall(method, path, body) {
    return window.LNbitsBridge.connect().then(function() {
      return window.LNbitsBridge.callApi(method, path, body);
    });
  }

  // Check if we have a magic token in the URL: /ext/giftcards/claim/{token}
  var pathParts = window.location.pathname.split('/');
  var magicToken = '';
  for (var i = 0; i < pathParts.length; i++) {
    if (pathParts[i] === 'claim' && i + 1 < pathParts.length) {
      magicToken = pathParts[i + 1];
      break;
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    var btn = $('btn-claim');
    if (btn) {
      btn.addEventListener('click', submitClaim);
    }
    if (magicToken) {
      verifyMagicToken(magicToken);
    }
  });

  function submitClaim() {
    var email = $('claim-email').value.trim();
    if (!email) {
      var err = $('claim-error');
      err.textContent = 'Please enter your email.';
      show(err);
      return;
    }
    hide($('claim-error'));
    $('btn-claim').disabled = true;
    $('claim-result').textContent = 'Sending...';

    apiCall('POST', '/claim', { email: email })
      .then(function(data) {
        $('btn-claim').disabled = false;
        if (data.message) {
          $('claim-result').textContent = data.message;
        } else if (data.error) {
          $('claim-result').textContent = data.error;
        }
      })
      .catch(function(err) {
        $('btn-claim').disabled = false;
        $('claim-result').textContent = 'Error: ' + (err.message || err);
      });
  }

  function verifyMagicToken(token) {
    apiCall('GET', '/claim/' + token, null)
      .then(function(data) {
        if (data.error || data.detail) {
          var err = $('claim-error');
          err.textContent = data.error || data.detail;
          show(err);
          hide($('claim-form-view'));
          return;
        }
        if (data.cards && data.cards.length > 0) {
          renderClaimedCards(data.cards);
        } else {
          var err2 = $('claim-error');
          err2.textContent = 'No pending gift cards found.';
          show(err2);
          hide($('claim-form-view'));
        }
      })
      .catch(function(err) {
        var e = $('claim-error');
        e.textContent = 'Error: ' + (err.message || err);
        show(e);
        hide($('claim-form-view'));
      });
  }

  function renderClaimedCards(cards) {
    hide($('claim-form-view'));
    var list = $('claim-cards-list');
    var html = '';
    cards.forEach(function(card) {
      var redeemUrl = '/ext/giftcards/redeem/' + (card.rawToken || card.tokenHash || '');
      html += '<div class="card-item">';
      html += '<div>';
      html += '<div class="amount">' + (card.amount || 0).toLocaleString() + ' sats</div>';
      if (card.senderName) html += '<div class="sender">From: ' + escapeHtml(card.senderName) + '</div>';
      if (card.message) html += '<div class="sender">' + escapeHtml(card.message) + '</div>';
      html += '</div>';
      html += '<a href="' + escapeHtml(redeemUrl) + '" class="btn btn-primary">Redeem</a>';
      html += '</div>';
    });
    list.innerHTML = html;
    show($('claim-cards-view'));
  }
})();
