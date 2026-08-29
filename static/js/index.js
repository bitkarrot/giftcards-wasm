// Gift Cards Admin UI — vanilla JS (no Vue, CSP-safe)
(function() {
  'use strict';

  var currentCards = [];
  var currentDetailCard = null;

  // --- Helpers ---
  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function formatSats(n) { return (n || 0).toLocaleString() + ' sats'; }
  function formatDate(s) {
    if (!s) return '';
    var n = parseInt(s, 10);
    if (isNaN(n)) return s;
    return new Date(n * 1000).toLocaleDateString();
  }

  // --- API via bridge ---
  var API_BASE = '/api/v1/ext/giftcards';
  function apiCall(method, path, body) {
    var fullPath = API_BASE + path;
    return window.LNbitsBridge.connect().then(function() {
      return window.LNbitsBridge.callApi(method, fullPath, body);
    });
  }

  // --- Load cards ---
  function loadCards() {
    var status = $('filter-status').value;
    $('loading-msg').textContent = 'Loading...';
    show($('loading-msg'));
    apiCall('GET', '/cards' + (status ? '?status=' + status : ''), null)
      .then(function(res) {
        var data = res.data || res;
        currentCards = Array.isArray(data) ? data : [];
        renderCards();
      })
      .catch(function(err) {
        $('loading-msg').textContent = 'Error: ' + (err.message || err);
      });
  }

  function renderCards() {
    var container = $('card-list-container');
    hide($('loading-msg'));
    if (currentCards.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="material-icons">card_giftcard</span><p>No gift cards yet. Create one to get started!</p></div>';
      return;
    }
    var html = '<div class="card-list">';
    currentCards.forEach(function(card) {
      var statusClass = 'status-' + (card.status || 'active');
      html += '<div class="gift-card" data-card-id="' + escapeHtml(card.id) + '">';
      html += '<div class="amount">' + formatSats(card.amount) + '</div>';
      html += '<span class="status ' + statusClass + '">' + escapeHtml(card.status || 'active') + '</span>';
      html += '<div class="meta">';
      html += '<div>To: ' + escapeHtml(card.recipientName || 'N/A') + '</div>';
      html += '<div>From: ' + escapeHtml(card.senderName || 'N/A') + '</div>';
      if (card.message) html += '<div>Msg: ' + escapeHtml(card.message) + '</div>';
      if (card.created_at || card.createdAt) html += '<div>Created: ' + escapeHtml(formatDate(card.created_at || card.createdAt)) + '</div>';
      html += '</div>';
      html += '<div class="actions">';
      html += '<button class="btn btn-sm" data-action="view">View</button>';
      if (card.recipientEmail) html += '<button class="btn btn-sm" data-action="deliver">Deliver</button>';
      html += '<button class="btn btn-sm btn-danger" data-action="delete">Delete</button>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    // Attach event listeners
    container.querySelectorAll('.gift-card').forEach(function(el) {
      var cardId = el.getAttribute('data-card-id');
      el.querySelectorAll('button[data-action]').forEach(function(btn) {
        var action = btn.getAttribute('data-action');
        btn.addEventListener('click', function() {
          if (action === 'view') showCardDetail(cardId);
          else if (action === 'delete') deleteCard(cardId);
          else if (action === 'deliver') openDeliverDialog(cardId);
        });
      });
    });
  }

  // --- Card Detail ---
  function showCardDetail(cardId) {
    apiCall('GET', '/cards/' + cardId, null)
      .then(function(res) {
        var card = res.data || res;
        currentDetailCard = card;
        $('card-dialog-title').textContent = 'Gift Card ' + (card.cardId || card.id);
        var body = $('card-dialog-body');
        var html = '';
        html += '<div class="detail-amount">' + formatSats(card.amount) + '</div>';
        html += '<div class="meta detail-meta">';
        html += '<div>Status: <span class="status status-' + (card.status || 'active') + '">' + escapeHtml(card.status || 'active') + '</span></div>';
        html += '<div>To: ' + escapeHtml(card.recipientName || 'N/A') + '</div>';
        html += '<div>From: ' + escapeHtml(card.senderName || 'N/A') + '</div>';
        if (card.message) html += '<div>Message: ' + escapeHtml(card.message) + '</div>';
        if (card.recipientEmail) html += '<div>Email: ' + escapeHtml(card.recipientEmail) + '</div>';
        html += '</div>';
        // QR code
        var redemptionUrl = card.redemptionUrl || (window.location.origin + '/ext/giftcards/redeem/' + (card.rawToken || ''));
        if (card.rawToken) {
          html += '<div class="qr-container"><canvas id="detail-qr"></canvas></div>';
          html += '<div class="detail-link"><a href="' + escapeHtml(redemptionUrl) + '" target="_blank">' + escapeHtml(redemptionUrl) + '</a></div>';
        }
        body.innerHTML = html;
        show($('card-dialog'));

        // Render QR
        if (card.rawToken) {
          setTimeout(function() {
            var canvas = $('detail-qr');
            if (canvas && window.QRCode) {
              window.QRCode.toCanvas(canvas, redemptionUrl, { width: 200 }, function() {});
            }
          }, 50);
        }
      })
      .catch(function(err) {
        alert('Error loading card: ' + (err.message || err));
      });
  }

  // --- Delete ---
  function deleteCard(cardId) {
    if (!confirm('Delete this gift card?')) return;
    apiCall('DELETE', '/cards/' + cardId, null)
      .then(function() { loadCards(); })
      .catch(function(err) { alert('Error: ' + (err.message || err)); });
  }

  // --- Create Dialog ---
  function openCreateDialog() {
    show($('create-dialog'));
  }

  function doCreate() {
    var selectedTemplate = document.querySelector('.template-preview.selected');
    var templateName = selectedTemplate ? selectedTemplate.getAttribute('data-template') : 'blue';
    var body = {
      amount: parseInt($('create-amount').value, 10),
      recipientName: $('create-recipient-name').value,
      recipientEmail: $('create-recipient-email').value,
      senderName: $('create-sender-name').value,
      message: $('create-message').value,
      designJson: JSON.stringify({template: templateName}),
    };
    var expiresAt = $('create-expires-at').value;
    if (expiresAt) body.expiresAt = expiresAt;
    if (!body.amount || body.amount < 1) { alert('Amount must be positive'); return; }

    $('btn-create-confirm').disabled = true;
    apiCall('POST', '/cards', body)
      .then(function(res) {
        hide($('create-dialog'));
        $('btn-create-confirm').disabled = false;
        loadCards();
        // Show the created card detail
        if (res && (res.cardId || res.id)) {
          showCardDetail(res.cardId || res.id);
        }
      })
      .catch(function(err) {
        $('btn-create-confirm').disabled = false;
        alert('Error: ' + (err.message || err));
      });
  }

  // --- Deliver Dialog ---
  function openDeliverDialog(cardId) {
    var card = currentCards.find(function(c) { return c.id === cardId; });
    if (card && card.recipientEmail) $('deliver-email').value = card.recipientEmail;
    $('deliver-dialog').setAttribute('data-card-id', cardId);
    show($('deliver-dialog'));
  }

  function doDeliver() {
    var cardId = $('deliver-dialog').getAttribute('data-card-id');
    var body = {
      email: $('deliver-email').value,
      apiUrl: $('deliver-api-url').value,
      apiKey: $('deliver-api-key').value,
    };
    var subject = $('deliver-subject').value;
    if (subject) body.subject = subject;
    $('btn-deliver-send').disabled = true;
    apiCall('POST', '/cards/' + cardId + '/deliver', body)
      .then(function(res) {
        hide($('deliver-dialog'));
        $('btn-deliver-send').disabled = false;
        alert(res.message || 'Email sent');
      })
      .catch(function(err) {
        $('btn-deliver-send').disabled = false;
        alert('Error: ' + (err.message || err));
      });
  }

  // --- Bulk Create ---
  function doBulkCreate() {
    var count = parseInt($('bulk-count').value, 10);
    var body = {
      count: count,
      amount: parseInt($('bulk-amount').value, 10),
      senderName: $('bulk-sender').value,
      message: $('bulk-message').value,
    };
    $('btn-bulk-create').disabled = true;
    $('bulk-result').textContent = 'Creating ' + count + ' cards...';
    apiCall('POST', '/cards/bulk', body)
      .then(function(res) {
        $('btn-bulk-create').disabled = false;
        var created = res.created || (res.data && res.data.length) || 0;
        $('bulk-result').textContent = 'Created ' + created + ' gift cards.';
      })
      .catch(function(err) {
        $('btn-bulk-create').disabled = false;
        $('bulk-result').textContent = 'Error: ' + (err.message || err);
      });
  }

  // --- Tabs ---
  function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    $('tab-' + tabName).classList.add('active');
    if (tabName === 'list') { show($('view-list')); hide($('view-bulk')); }
    else { hide($('view-list')); show($('view-bulk')); }
  }

  // --- Download image ---
  function downloadCardImage() {
    if (!currentDetailCard) return;
    var canvas = $('detail-qr');
    if (!canvas) return;
    var link = document.createElement('a');
    link.download = 'giftcard-' + (currentDetailCard.cardId || currentDetailCard.id) + '.png';
    link.href = canvas.toDataURL();
    link.click();
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', function() {
    // Tabs
    $('tab-list').addEventListener('click', function() { switchTab('list'); });
    $('tab-bulk').addEventListener('click', function() { switchTab('bulk'); });

    // Create
    $('btn-create').addEventListener('click', openCreateDialog);
    $('btn-create-cancel').addEventListener('click', function() { hide($('create-dialog')); });
    $('btn-create-confirm').addEventListener('click', doCreate);

    // Template selector
    document.querySelectorAll('.template-preview').forEach(function(img) {
      img.addEventListener('click', function() {
        document.querySelectorAll('.template-preview').forEach(function(el) { el.classList.remove('selected'); });
        img.classList.add('selected');
      });
    });

    // Deliver
    $('btn-deliver-cancel').addEventListener('click', function() { hide($('deliver-dialog')); });
    $('btn-deliver-send').addEventListener('click', doDeliver);

    // Card dialog
    $('btn-card-close').addEventListener('click', function() { hide($('card-dialog')); });
    $('btn-download-image').addEventListener('click', downloadCardImage);

    // Bulk
    $('btn-bulk-create').addEventListener('click', doBulkCreate);

    // Filters
    $('filter-status').addEventListener('change', loadCards);
    $('btn-search').addEventListener('click', loadCards);

    // Load initial data
    loadCards();
  });
})();
