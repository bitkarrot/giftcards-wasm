// Gift Cards Admin UI — vanilla JS (no Vue, CSP-safe)
// Full feature parity with Python giftcards extension
(function() {
  'use strict';

  var currentCards = [];
  var currentDetailCard = null;
  var currentDetailRedemptionUrl = '';
  var selectedCards = new Set();
  var currentPage = 1;
  var rowsPerPage = 25;
  var sortColumn = 'created_at';
  var sortDesc = true;
  var currentFilters = { status: '', search: '' };

  // Design state
  var design = {
    template: 'portrait',
    qrX: 0.1, qrY: 0.7, qrSize: 200,
    textX: 0.1, textY: 0.1,
    fontFamily: 'DejaVuSans', fontSize: 24,
    fontColor: '#000000', bgColor: '#1976d2',
    textAlign: 'left',
    showAmount: true, showRecipient: true, showMessage: true,
    bgColorEnabled: false,
    customTemplateData: null,
  };

  // Drag state
  var dragState = { dragging: null, startX: 0, startY: 0, elemStartX: 0, elemStartY: 0 };
  var resizeState = { resizing: false, startX: 0, startY: 0, startW: 0, startH: 0 };

  // CSV state
  var csvRows = [];
  var csvErrors = [];

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
    var n = parseFloat(s);
    if (isNaN(n)) return s;
    return new Date(n * 1000).toLocaleDateString();
  }
  function getStatusColor(status) {
    return { active: 'status-active', redeemed: 'status-redeemed', expired: 'status-expired', redeeming: 'status-redeeming' }[status] || 'status-active';
  }
  function getDeliveryColor(status) {
    return { not_sent: 'delivery-not_sent', sent: 'delivery-sent', failed: 'delivery-failed' }[status] || 'delivery-not_sent';
  }

  // --- Toast ---
  var toastTimer = null;
  function toast(message, type) {
    var el = $('toast');
    el.textContent = message;
    el.style.background = type === 'error' ? '#e53935' : (type === 'success' ? '#2e7d32' : '#333');
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.classList.add('hidden'); }, 4000);
  }

  // --- Confirm Dialog ---
  function confirmDialog(title, message, onConfirm, bannerText) {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    var banner = $('confirm-banner');
    if (bannerText) {
      banner.textContent = bannerText;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
    show($('confirm-dialog'));
    var okBtn = $('btn-confirm-ok');
    var cancelBtn = $('btn-confirm-cancel');
    var cleanup = function() {
      hide($('confirm-dialog'));
      okBtn.removeEventListener('click', okHandler);
      cancelBtn.removeEventListener('click', cancelHandler);
    };
    var okHandler = function() { cleanup(); onConfirm(); };
    var cancelHandler = function() { cleanup(); };
    okBtn.addEventListener('click', okHandler);
    cancelBtn.addEventListener('click', cancelHandler);
  }

  // --- API via bridge ---
  var API_BASE = '/api/v1/ext/giftcards_wasm';
  function apiCall(method, path, body) {
    var fullPath = API_BASE + path;
    return window.LNbitsBridge.connect().then(function() {
      return window.LNbitsBridge.callApi(method, fullPath, body);
    });
  }

  // --- Load cards ---
  function loadCards() {
    currentFilters.status = $('filter-status').value;
    currentFilters.search = $('search-query').value;
    $('loading-msg').textContent = 'Loading...';
    show($('loading-msg'));
    var qs = '';
    if (currentFilters.status) qs += '?status=' + encodeURIComponent(currentFilters.status);
    if (currentFilters.search) {
      qs += (qs ? '&' : '?') + 'search=' + encodeURIComponent(currentFilters.search);
    }
    // Show/clear filters button
    $('btn-clear-filters').style.display = (currentFilters.status || currentFilters.search) ? '' : 'none';

    apiCall('GET', '/cards' + qs, null)
      .then(function(res) {
        var data = res.data || res;
        currentCards = Array.isArray(data) ? data : [];
        selectedCards.clear();
        renderTable();
      })
      .catch(function(err) {
        $('loading-msg').textContent = 'Error: ' + (err.message || err);
      });
  }

  // --- Render Table ---
  function renderTable() {
    var container = $('card-list-container');
    hide($('loading-msg'));
    updateBulkActionBar();

    if (currentCards.length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="material-icons">card_giftcard</span><p>No gift cards yet. Create one to get started!</p></div>';
      $('pagination').style.display = 'none';
      return;
    }

    // Sort
    var sorted = currentCards.slice().sort(function(a, b) {
      var av = a[sortColumn] || a[camelize(sortColumn)] || '';
      var bv = b[sortColumn] || b[camelize(sortColumn)] || '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDesc ? bv - av : av - bv;
      }
      var as = String(av), bs = String(bv);
      if (sortDesc) return bs.localeCompare(as);
      return as.localeCompare(bs);
    });

    // Paginate
    var totalPages = Math.ceil(sorted.length / rowsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    var startIdx = (currentPage - 1) * rowsPerPage;
    var pageCards = sorted.slice(startIdx, startIdx + rowsPerPage);

    // Build table
    var html = '<table class="card-table"><thead><tr>';
    html += '<th class="checkbox-cell"><input type="checkbox" id="select-all"></th>';
    html += '<th style="width:30px;"></th>'; // expand
    html += makeTh('amount', 'Amount');
    html += makeTh('status', 'Status');
    html += makeTh('recipient_name', 'Recipient');
    html += makeTh('sender_name', 'Sender');
    html += makeTh('email_status', 'Delivery');
    html += makeTh('created_at', 'Created');
    html += '<th class="actions-cell">Actions</th>';
    html += '</tr></thead><tbody>';

    pageCards.forEach(function(card) {
      var id = card.id || card.cardId;
      var isSelected = selectedCards.has(id);
      html += '<tr data-card-id="' + escapeHtml(id) + '">';
      html += '<td class="checkbox-cell"><input type="checkbox" class="row-checkbox" data-card-id="' + escapeHtml(id) + '"' + (isSelected ? ' checked' : '') + '></td>';
      html += '<td><button class="btn btn-sm expand-btn" data-card-id="' + escapeHtml(id) + '"><span class="material-icons" style="font-size:18px;">expand_more</span></button></td>';
      html += '<td>' + formatSats(card.amount) + '</td>';
      html += '<td><span class="status-badge ' + getStatusColor(card.status) + '">' + escapeHtml(card.status) + '</span></td>';
      html += '<td>' + escapeHtml(card.recipientName || card.recipient_name || '—') + '</td>';
      html += '<td>' + escapeHtml(card.senderName || card.sender_name || '—') + '</td>';
      var emailStatus = card.emailStatus || card.email_status || 'not_sent';
      if (card.recipientEmail || card.recipient_email) {
        html += '<td><span class="status-badge ' + getDeliveryColor(emailStatus) + '">' + escapeHtml(emailStatus) + '</span></td>';
      } else {
        html += '<td>—</td>';
      }
      html += '<td>' + escapeHtml(formatDate(card.createdAt || card.created_at)) + '</td>';
      html += '<td class="actions-cell">';
      html += '<button class="btn btn-sm" data-action="view" data-card-id="' + escapeHtml(id) + '" title="View"><span class="material-icons" style="font-size:16px;">info</span></button>';
      html += '<button class="btn btn-sm" data-action="email" data-card-id="' + escapeHtml(id) + '" title="Send Email"><span class="material-icons" style="font-size:16px;">mail</span></button>';
      html += '<button class="btn btn-sm" data-action="download" data-card-id="' + escapeHtml(id) + '" title="Download"><span class="material-icons" style="font-size:16px;">download</span></button>';
      html += '<button class="btn btn-sm" data-action="edit" data-card-id="' + escapeHtml(id) + '" title="Edit" ' + (card.status === 'redeemed' ? 'disabled' : '') + '><span class="material-icons" style="font-size:16px;">edit</span></button>';
      html += '<button class="btn btn-sm btn-danger" data-action="delete" data-card-id="' + escapeHtml(id) + '" title="Delete"><span class="material-icons" style="font-size:16px;">delete</span></button>';
      html += '</td>';
      html += '</tr>';

      // Expandable row
      html += '<tr class="expand-row" id="expand-' + escapeHtml(id) + '"><td colspan="9"><div class="expand-content">';
      html += '<div class="expand-grid">';
      html += '<div><div class="label">From</div><div class="value">' + escapeHtml(card.senderName || card.sender_name || 'Anonymous') + '</div></div>';
      html += '<div><div class="label">Message</div><div class="value">' + escapeHtml(card.message || 'No message') + '</div></div>';
      html += '<div><div class="label">Created</div><div class="value">' + escapeHtml(formatDate(card.createdAt || card.created_at)) + '</div></div>';
      html += '<div><div class="label">Status</div><div class="value"><span class="status-badge ' + getStatusColor(card.status) + '">' + escapeHtml(card.status) + '</span></div></div>';
      html += '<div><div class="label">Expires</div><div class="value">' + (card.expiresAt || card.expires_at ? escapeHtml(formatDate(card.expiresAt || card.expires_at)) : 'Never') + '</div></div>';
      html += '<div><div class="label">Email</div><div class="value">' + escapeHtml(card.recipientEmail || card.recipient_email || '—') + '</div></div>';
      html += '</div>';
      var redUrl = card.redemptionUrl || card.redemption_url || '';
      if (redUrl) {
        html += '<div class="copy-link-row"><input type="text" readonly value="' + escapeHtml(redUrl) + '"><button class="btn btn-sm copy-link-btn" data-url="' + escapeHtml(redUrl) + '">Copy</button></div>';
      }
      html += '</div></td></tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Pagination
    if (totalPages > 1) {
      $('pagination').style.display = 'flex';
      $('page-info').textContent = 'Page ' + currentPage + ' of ' + totalPages;
    } else {
      $('pagination').style.display = 'none';
    }

    // Attach event listeners
    attachTableEvents();
  }

  function makeTh(col, label) {
    var arrow = '';
    if (sortColumn === col) arrow = sortDesc ? ' ↓' : ' ↑';
    return '<th data-sort="' + col + '">' + label + '<span class="sort-arrow">' + arrow + '</span></th>';
  }

  function camelize(s) {
    return s.replace(/_([a-z])/g, function(g) { return g[1].toUpperCase(); });
  }

  function attachTableEvents() {
    // Sort headers
    document.querySelectorAll('.card-table th[data-sort]').forEach(function(th) {
      th.addEventListener('click', function() {
        var col = th.getAttribute('data-sort');
        if (sortColumn === col) { sortDesc = !sortDesc; }
        else { sortColumn = col; sortDesc = true; }
        renderTable();
      });
    });

    // Row checkboxes
    document.querySelectorAll('.row-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var id = cb.getAttribute('data-card-id');
        if (cb.checked) selectedCards.add(id);
        else selectedCards.delete(id);
        updateBulkActionBar();
      });
    });

    // Select all
    var selectAll = $('select-all');
    if (selectAll) {
      selectAll.addEventListener('change', function() {
        document.querySelectorAll('.row-checkbox').forEach(function(cb) {
          cb.checked = selectAll.checked;
          var id = cb.getAttribute('data-card-id');
          if (selectAll.checked) selectedCards.add(id);
          else selectedCards.delete(id);
        });
        updateBulkActionBar();
      });
    }

    // Expand buttons
    document.querySelectorAll('.expand-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-card-id');
        var row = $('expand-' + id);
        if (row) row.classList.toggle('show');
        var icon = btn.querySelector('.material-icons');
        if (icon) icon.textContent = row.classList.contains('show') ? 'expand_less' : 'expand_more';
      });
    });

    // Action buttons
    document.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-card-id');
        if (action === 'view') showCardDetail(id);
        else if (action === 'delete') deleteCard(id);
        else if (action === 'email') openDeliverDialog(id);
        else if (action === 'edit') openEditDialog(id);
        else if (action === 'download') downloadCardImageById(id);
      });
    });

    // Copy link buttons
    document.querySelectorAll('.copy-link-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        copyToClipboard(btn.getAttribute('data-url'));
      });
    });
  }

  function updateBulkActionBar() {
    var bar = $('bulk-action-bar');
    if (selectedCards.size > 0) {
      bar.style.display = 'flex';
      $('selected-count').textContent = selectedCards.size + ' selected';
    } else {
      bar.style.display = 'none';
    }
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
        html += '<div class="detail-meta">';
        html += '<div>Status: <span class="status-badge ' + getStatusColor(card.status) + '">' + escapeHtml(card.status) + '</span></div>';
        html += '<div>To: ' + escapeHtml(card.recipientName || card.recipient_name || 'N/A') + '</div>';
        html += '<div>From: ' + escapeHtml(card.senderName || card.sender_name || 'N/A') + '</div>';
        if (card.message) html += '<div>Message: ' + escapeHtml(card.message) + '</div>';
        if (card.recipientEmail || card.recipient_email) html += '<div>Email: ' + escapeHtml(card.recipientEmail || card.recipient_email) + '</div>';
        var exp = card.expiresAt || card.expires_at;
        if (exp) html += '<div>Expires: ' + escapeHtml(formatDate(exp)) + '</div>';
        var red = card.redeemedAt || card.redeemed_at;
        if (red) html += '<div>Redeemed: ' + escapeHtml(formatDate(red)) + '</div>';
        var emailStatus = card.emailStatus || card.email_status || 'not_sent';
        html += '<div>Delivery: <span class="status-badge ' + getDeliveryColor(emailStatus) + '">' + escapeHtml(emailStatus) + '</span></div>';
        html += '</div>';
        // QR code
        var redemptionUrl = card.redemptionUrl || card.redemption_url || (window.location.origin + '/ext/giftcards_wasm/redeem/' + (card.rawToken || card.raw_token || ''));
        currentDetailRedemptionUrl = redemptionUrl;
        if (card.rawToken || card.raw_token) {
          html += '<div class="qr-container"><canvas id="detail-qr"></canvas></div>';
          html += '<div class="detail-link"><input type="text" id="detail-link-input" readonly value="' + escapeHtml(redemptionUrl) + '" style="width:100%;padding:6px;border:1px solid var(--gc-border);border-radius:4px;background:var(--gc-input-bg);color:var(--gc-text);font-size:12px;"></div>';
          html += '<div class="detail-actions" style="margin-top:8px;">';
          html += '<button class="btn btn-sm" id="btn-copy-link">Copy Link</button>';
          html += '<button class="btn btn-sm btn-primary" id="btn-open-link">Open in New Tab</button>';
          html += '</div>';
        }
        body.innerHTML = html;
        show($('card-dialog'));

        // Render QR
        if (card.rawToken || card.raw_token) {
          setTimeout(function() {
            var canvas = $('detail-qr');
            if (canvas && window.QRCode) {
              window.QRCode.toCanvas(canvas, redemptionUrl, { width: 200 }, function() {});
            }
          }, 50);

          // Copy link
          var copyBtn = $('btn-copy-link');
          if (copyBtn) copyBtn.addEventListener('click', function() {
            copyToClipboard(redemptionUrl);
          });

          // Open in new tab
          var openBtn = $('btn-open-link');
          if (openBtn) openBtn.addEventListener('click', function() {
            window.LNbitsBridge.connect().then(function() {
              return window.LNbitsBridge.openInNewTab(redemptionUrl);
            }).catch(function(err) {
              toast('Could not open link: ' + (err.message || err), 'error');
            });
          });
        }
      })
      .catch(function(err) {
        toast('Error loading card: ' + (err.message || err), 'error');
      });
  }

  // --- Copy to clipboard ---
  function copyToClipboard(text) {
    var copied = false;
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch(e) {}
    if (!copied) {
      try {
        navigator.clipboard.writeText(text).then(function() { copied = true; }).catch(function() {});
      } catch(e) {}
    }
    toast(copied ? 'Copied to clipboard' : 'Copy failed - select text manually', copied ? 'success' : 'error');
  }

  // --- Delete ---
  function deleteCard(cardId) {
    var card = currentCards.find(function(c) { return (c.id || c.cardId) === cardId; });
    var amount = card ? card.amount : 0;
    var status = card ? card.status : 'active';
    var banner = '';
    if (status === 'active') {
      banner = 'The ' + amount + ' sats locked in this card will be returned to your wallet before deletion.';
    } else if (status === 'expired') {
      banner = 'Sats from this expired card have already been reclaimed. Only the card record will be deleted.';
    }
    confirmDialog('Delete Gift Card?', 'Are you sure? This will permanently delete this card.', function() {
      apiCall('DELETE', '/cards/' + cardId, null)
        .then(function() { toast('Gift card deleted', 'success'); loadCards(); })
        .catch(function(err) { toast('Error: ' + (err.message || err), 'error'); });
    }, banner);
  }

  // --- Bulk Delete ---
  function bulkDelete() {
    var ids = Array.from(selectedCards);
    if (ids.length === 0) return;
    var activeCards = currentCards.filter(function(c) { return ids.includes(c.id || c.cardId) && c.status === 'active'; });
    var activeAmount = activeCards.reduce(function(sum, c) { return sum + c.amount; }, 0);
    var msg = 'Delete ' + ids.length + ' card(s)?';
    if (activeAmount > 0) msg += ' ' + activeAmount + ' sats will be reclaimed.';
    confirmDialog('Delete Selected Cards?', msg, function() {
      apiCall('DELETE', '/cards/bulk', { cardIds: ids })
        .then(function() { toast('Cards deleted', 'success'); selectedCards.clear(); loadCards(); })
        .catch(function(err) { toast('Error: ' + (err.message || err), 'error'); });
    });
  }

  // --- Create Dialog ---
  function openCreateDialog() {
    $('create-form-view').style.display = '';
    $('create-result-view').style.display = 'none';
    $('create-dialog-title').textContent = 'Create Gift Card';
    show($('create-dialog'));
    updateDesignPreview();
  }

  function doCreate() {
    var amount = parseInt($('create-amount').value, 10);
    if (!amount || amount < 1) { toast('Amount must be positive', 'error'); return; }

    var body = {
      amount: amount,
      recipientName: $('create-recipient-name').value,
      recipientEmail: $('create-recipient-email').value,
      senderName: $('create-sender-name').value,
      message: $('create-message').value,
    };
    var expiresAt = $('create-expires-at').value;
    if (expiresAt) body.expiresAt = expiresAt;

    // Add design if shared mode
    if ($('create-design-mode').value === 'shared') {
      body.design = buildDesignConfig();
    }

    $('btn-create-confirm').disabled = true;
    apiCall('POST', '/cards', body)
      .then(function(res) {
        $('btn-create-confirm').disabled = false;
        var data = res.data || res;
        // Show success view
        $('create-form-view').style.display = 'none';
        $('create-result-view').style.display = '';
        $('create-dialog-title').textContent = '';
        var redUrl = data.redemptionUrl || data.redemption_url || '';
        $('result-redemption-url').value = redUrl;
        loadCards();
      })
      .catch(function(err) {
        $('btn-create-confirm').disabled = false;
        toast('Error: ' + (err.message || err), 'error');
      });
  }

  function buildDesignConfig() {
    return {
      templateName: design.template,
      qrXFrac: design.qrX,
      qrYFrac: design.qrY,
      qrSize: design.qrSize,
      textXFrac: design.textX,
      textYFrac: design.textY,
      fontFamily: design.fontFamily,
      fontSize: design.fontSize,
      fontColor: design.fontColor,
      bgColor: design.bgColorEnabled ? design.bgColor : null,
      textAlign: design.textAlign,
      showAmount: design.showAmount,
      showRecipient: design.showRecipient,
      showMessage: design.showMessage,
    };
  }

  // --- Edit Dialog ---
  function openEditDialog(cardId) {
    var card = currentCards.find(function(c) { return (c.id || c.cardId) === cardId; });
    if (!card) return;
    apiCall('GET', '/cards/' + cardId, null).then(function(res) {
      var c = res.data || res;
      $('edit-recipient-name').value = c.recipientName || c.recipient_name || '';
      $('edit-sender-name').value = c.senderName || c.sender_name || '';
      $('edit-message').value = c.message || '';
      $('edit-recipient-email').value = c.recipientEmail || c.recipient_email || '';
      $('edit-amount').value = c.amount;
      $('edit-dialog').setAttribute('data-card-id', cardId);
      show($('edit-dialog'));
    }).catch(function(err) {
      toast('Error loading card: ' + (err.message || err), 'error');
    });
  }

  function doEdit() {
    var cardId = $('edit-dialog').getAttribute('data-card-id');
    var body = {
      recipientName: $('edit-recipient-name').value,
      senderName: $('edit-sender-name').value,
      message: $('edit-message').value,
      recipientEmail: $('edit-recipient-email').value,
    };
    apiCall('PUT', '/cards/' + cardId, body)
      .then(function() {
        hide($('edit-dialog'));
        toast('Card updated', 'success');
        loadCards();
      })
      .catch(function(err) { toast('Error: ' + (err.message || err), 'error'); });
  }

  // --- Deliver Dialog ---
  function openDeliverDialog(cardId) {
    var card = currentCards.find(function(c) { return (c.id || c.cardId) === cardId; });
    if (card && (card.recipientEmail || card.recipient_email)) {
      $('deliver-email').value = card.recipientEmail || card.recipient_email;
    } else {
      $('deliver-email').value = '';
    }
    $('deliver-dialog').setAttribute('data-card-id', cardId);
    updateDeliverMode();
    show($('deliver-dialog'));
  }

  function updateDeliverMode() {
    var mode = $('deliver-mode').value;
    $('deliver-body-group').style.display = mode === 'custom' ? '' : 'none';
    $('deliver-bg-color-group').style.display = mode === 'fancy' ? '' : 'none';
  }

  function doDeliver() {
    var cardId = $('deliver-dialog').getAttribute('data-card-id');
    var body = {
      email: $('deliver-email').value,
      apiUrl: $('deliver-api-url').value,
      apiKey: $('deliver-api-key').value,
      mode: $('deliver-mode').value,
    };
    var subject = $('deliver-subject').value;
    if (subject) body.subject = subject;
    if (body.mode === 'custom') body.body = $('deliver-body').value;
    if (body.mode === 'fancy') body.bgColor = $('deliver-bg-color').value;
    $('btn-deliver-send').disabled = true;
    apiCall('POST', '/cards/' + cardId + '/deliver', body)
      .then(function(res) {
        hide($('deliver-dialog'));
        $('btn-deliver-send').disabled = false;
        toast(res.message || 'Email sent', 'success');
        loadCards();
      })
      .catch(function(err) {
        $('btn-deliver-send').disabled = false;
        toast('Error: ' + (err.message || err), 'error');
      });
  }

  // --- Bulk Create ---
  function openBulkDialog() { show($('bulk-dialog')); }
  function switchBulkTab(tab) {
    document.querySelectorAll('[data-bulk-tab]').forEach(function(t) { t.classList.remove('active'); });
    $('bulk-tab-' + tab).classList.add('active');
    $('bulk-same-view').style.display = tab === 'same' ? '' : 'none';
    $('bulk-csv-view').style.display = tab === 'csv' ? '' : 'none';
  }

  function doBulkCreate() {
    var activeTab = document.querySelector('[data-bulk-tab].active').getAttribute('data-bulk-tab');
    if (activeTab === 'same') {
      var count = parseInt($('bulk-count').value, 10);
      var amount = parseInt($('bulk-amount').value, 10);
      if (!count || count < 1) { toast('Count must be positive', 'error'); return; }
      if (!amount || amount < 1) { toast('Amount must be positive', 'error'); return; }
      var body = {
        count: count,
        amount: amount,
        senderName: $('bulk-sender-name').value,
        recipientName: $('bulk-recipient-name').value,
        message: $('bulk-message').value,
      };
      var exp = $('bulk-expires-at').value;
      if (exp) body.expiresAt = exp;
      $('btn-bulk-create').disabled = true;
      $('bulk-result').textContent = 'Creating ' + count + ' cards...';
      apiCall('POST', '/cards/bulk', body)
        .then(function(res) {
          $('btn-bulk-create').disabled = false;
          var data = res.data || res;
          var created = (Array.isArray(data) ? data.length : 0) || res.created || 0;
          $('bulk-result').textContent = 'Created ' + created + ' gift cards.';
          toast('Created ' + created + ' cards', 'success');
          loadCards();
        })
        .catch(function(err) {
          $('btn-bulk-create').disabled = false;
          $('bulk-result').textContent = 'Error: ' + (err.message || err);
          toast('Error: ' + (err.message || err), 'error');
        });
    } else {
      // CSV mode
      if (csvRows.length === 0) { toast('No valid CSV rows', 'error'); return; }
      $('btn-bulk-create').disabled = true;
      $('bulk-result').textContent = 'Creating ' + csvRows.length + ' cards...';
      apiCall('POST', '/cards/bulk', { rows: csvRows })
        .then(function(res) {
          $('btn-bulk-create').disabled = false;
          var data = res.data || res;
          var created = (Array.isArray(data) ? data.length : 0) || res.created || 0;
          $('bulk-result').textContent = 'Created ' + created + ' gift cards.';
          toast('Created ' + created + ' cards', 'success');
          loadCards();
        })
        .catch(function(err) {
          $('btn-bulk-create').disabled = false;
          $('bulk-result').textContent = 'Error: ' + (err.message || err);
          toast('Error: ' + (err.message || err), 'error');
        });
    }
  }

  // --- CSV ---
  function downloadCsvTemplate() {
    var csv = 'recipient_name,amount_sats,recipient_email,sender_name,message\nAlice,1000,alice@example.com,Bob,Happy birthday!\n';
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.download = 'giftcards_template.csv';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  function parseCsvFile(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var text = e.target.result;
      var lines = text.split('\n').filter(function(l) { return l.trim(); });
      if (lines.length < 2) { toast('CSV must have a header and at least one row', 'error'); return; }
      var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^["']|["']$/g, ''); });
      csvRows = [];
      csvErrors = [];
      for (var i = 1; i < lines.length; i++) {
        var vals = parseCsvLine(lines[i]);
        var row = {};
        headers.forEach(function(h, idx) { row[h] = vals[idx] || ''; });
        row.row_num = i + 1;
        var errors = validateCsvRow(row);
        if (errors.length > 0) {
          csvErrors.push({ row_num: row.row_num, errors: errors });
        } else {
          csvRows.push(row);
        }
      }
      renderCsvValidation();
    };
    reader.readAsText(file);
  }

  function parseCsvLine(line) {
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
      else { current += ch; }
    }
    result.push(current);
    return result.map(function(v) { return v.trim().replace(/^["']|["']$/g, ''); });
  }

  function validateCsvRow(row) {
    var errors = [];
    if (!row.recipient_name) errors.push('recipient_name is required');
    var amt = parseInt(row.amount_sats, 10);
    if (!amt || amt < 1) errors.push('amount_sats must be > 0');
    return errors;
  }

  function renderCsvValidation() {
    var container = $('csv-validation-result');
    var banner = $('csv-validation-banner');
    var tableDiv = $('csv-validation-table');
    container.style.display = '';

    if (csvErrors.length === 0) {
      banner.className = 'info-banner';
      banner.innerHTML = '<span class="material-icons">check_circle</span>' + csvRows.length + ' valid rows ready to create.';
    } else {
      banner.className = 'info-banner';
      banner.style.background = 'var(--gc-warning-bg)';
      banner.innerHTML = '<span class="material-icons" style="color:var(--gc-warning)">warning</span>' + csvRows.length + ' valid, ' + csvErrors.length + ' errors. Fix all errors in your CSV and re-upload.';
    }

    var html = '<table class="csv-table"><thead><tr><th>Row</th><th>Status</th><th>Recipient</th><th>Amount</th><th>Email</th><th>Errors</th></tr></thead><tbody>';
    csvRows.forEach(function(row) {
      html += '<tr><td>' + row.row_num + '</td><td><span class="material-icons" style="color:var(--gc-success);font-size:16px;">check_circle</span></td><td>' + escapeHtml(row.recipient_name) + '</td><td>' + escapeHtml(row.amount_sats) + '</td><td>' + escapeHtml(row.recipient_email || '—') + '</td><td>—</td></tr>';
    });
    csvErrors.forEach(function(err) {
      html += '<tr class="error-row"><td>' + err.row_num + '</td><td><span class="material-icons" style="color:var(--gc-danger);font-size:16px;">error</span></td><td>—</td><td>—</td><td>—</td><td>' + escapeHtml(err.errors.join('; ')) + '</td></tr>';
    });
    html += '</tbody></table>';
    tableDiv.innerHTML = html;
  }

  // --- Download CSV of cards ---
  function downloadCsv() {
    var csv = 'id,amount,status,recipient_name,sender_name,message,recipient_email,email_status,created_at\n';
    currentCards.forEach(function(c) {
      csv += [c.id, c.amount, c.status, c.recipientName || c.recipient_name, c.senderName || c.sender_name, c.message, c.recipientEmail || c.recipient_email, c.emailStatus || c.email_status, c.createdAt || c.created_at].map(function(v) {
        return '"' + String(v || '').replace(/"/g, '""') + '"';
      }).join(',') + '\n';
    });
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.download = 'giftcards.csv';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- Bulk Email ---
  function openBulkEmailDialog() {
    var cards = currentCards.filter(function(c) { return selectedCards.has(c.id || c.cardId) && (c.recipientEmail || c.recipient_email); });
    var listDiv = $('bulk-email-list');
    if (cards.length === 0) {
      listDiv.innerHTML = '<div class="info-banner"><span class="material-icons">warning</span>No cards with recipient email addresses were found. Add an email address to a card before sending.</div>';
    } else {
      var html = '';
      cards.forEach(function(c) {
        var id = c.id || c.cardId;
        html += '<div class="bulk-email-item">';
        html += '<input type="checkbox" class="bulk-email-checkbox" data-card-id="' + escapeHtml(id) + '" checked>';
        html += '<div class="email-info"><div class="email-name">' + escapeHtml(c.recipientName || c.recipient_name || '—') + '</div><div class="email-addr">' + escapeHtml(c.recipientEmail || c.recipient_email) + '</div></div>';
        html += '<div class="email-amount">' + formatSats(c.amount) + '</div>';
        html += '</div>';
      });
      listDiv.innerHTML = html;
    }
    show($('bulk-email-dialog'));
  }

  function doBulkEmail() {
    var ids = [];
    document.querySelectorAll('.bulk-email-checkbox:checked').forEach(function(cb) {
      ids.push(cb.getAttribute('data-card-id'));
    });
    if (ids.length === 0) { toast('No cards selected', 'error'); return; }
    var apiUrl = $('deliver-api-url').value;
    var apiKey = $('deliver-api-key').value;
    // If empty, prompt for API details
    if (!apiUrl) { toast('Please set Email API URL in the deliver dialog first', 'error'); return; }
    var promises = ids.map(function(id) {
      return apiCall('POST', '/cards/' + id + '/deliver', { email: '', apiUrl: apiUrl, apiKey: apiKey, mode: 'fancy' });
    });
    Promise.all(promises).then(function() {
      toast('Sent ' + ids.length + ' emails', 'success');
      hide($('bulk-email-dialog'));
      loadCards();
    }).catch(function(err) {
      toast('Some emails failed: ' + (err.message || err), 'error');
    });
  }

  // --- Download image ---
  function downloadCardImageById(cardId) {
    // Fetch card detail, then render composite image
    apiCall('GET', '/cards/' + cardId, null).then(function(res) {
      currentDetailCard = res.data || res;
      // Wait for QR canvas to be available — render in detail dialog first
      showCardDetail(cardId);
      setTimeout(function() { downloadCardImage(); }, 500);
    });
  }

  function downloadCardImage() {
    if (!currentDetailCard) return;
    var qrCanvas = $('detail-qr');
    if (!qrCanvas) { toast('No QR code to download', 'error'); return; }

    var canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 500;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 500);
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 380, 480);
    ctx.fillStyle = '#1976d2';
    ctx.font = 'bold 24px Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Gift Card', 200, 50);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 32px Roboto, sans-serif';
    ctx.fillText(formatSats(currentDetailCard.amount), 200, 100);
    ctx.font = '14px Roboto, sans-serif';
    ctx.textAlign = 'left';
    var y = 140;
    ctx.fillText('To: ' + (currentDetailCard.recipientName || currentDetailCard.recipient_name || 'N/A'), 30, y); y += 24;
    ctx.fillText('From: ' + (currentDetailCard.senderName || currentDetailCard.sender_name || 'N/A'), 30, y); y += 24;
    if (currentDetailCard.message) { ctx.fillText('Message: ' + currentDetailCard.message, 30, y); y += 24; }
    y += 10;
    ctx.drawImage(qrCanvas, 100, y, 200, 200);
    y += 220;
    ctx.font = '11px Roboto, sans-serif';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    var url = currentDetailRedemptionUrl || '';
    if (url.length > 55) url = url.substring(0, 52) + '...';
    ctx.fillText(url, 200, y);

    var dataUrl = canvas.toDataURL('image/png');
    var link = document.createElement('a');
    link.download = 'giftcard-' + (currentDetailCard.cardId || currentDetailCard.id) + '.png';
    link.href = dataUrl;
    var clicked = false;
    try { link.click(); clicked = true; } catch(e) {}
    if (!clicked) {
      window.LNbitsBridge.connect().then(function() {
        return window.LNbitsBridge.openInNewTab(dataUrl);
      }).then(function() {
        toast('Image opened in new tab - right-click to save', 'success');
      }).catch(function() {
        toast('Could not download. Right-click the QR code to save it.', 'error');
      });
    } else {
      toast('Image downloaded', 'success');
    }
  }

  // --- Card Designer ---
  function updateDesignPreview() {
    var editor = $('design-editor');
    var mode = $('create-design-mode').value;
    editor.style.display = mode === 'shared' ? '' : 'none';
    if (mode === 'shared') {
      updateTemplateImage();
      updateTextPreview();
    }
  }

  function updateTemplateImage() {
    var img = $('preview-template-img');
    var preview = $('card-preview');
    if (design.bgColorEnabled) {
      img.style.display = 'none';
      preview.style.background = design.bgColor;
    } else {
      preview.style.background = '#f5f5f5';
      if (design.template === 'custom' && design.customTemplateData) {
        img.src = design.customTemplateData;
        img.style.display = '';
      } else if (design.template !== 'custom') {
        img.src = '/ext-assets/giftcards_wasm/image/template_' + design.template + '.png';
        img.style.display = '';
      } else {
        img.style.display = 'none';
      }
    }
    // Adjust preview dimensions for landscape
    if (design.template === 'landscape') {
      preview.classList.add('landscape');
    } else {
      preview.classList.remove('landscape');
    }
  }

  function updateTextPreview() {
    var content = $('preview-text-content');
    var html = '';
    if (design.showAmount) html += '<div>' + ($('create-amount').value || 0) + ' sats</div>';
    if (design.showRecipient) html += '<div>For: ' + ($('create-recipient-name').value || 'Recipient') + '</div>';
    if (design.showMessage) html += '<div>' + ($('create-message').value || 'Your message') + '</div>';
    content.innerHTML = html;
    content.style.fontFamily = design.fontFamily === 'DejaVuSerif' ? 'serif' : (design.fontFamily === 'DejaVuSansMono' ? 'monospace' : 'sans-serif');
    content.style.fontSize = design.fontSize + 'px';
    content.style.color = design.fontColor;
    content.style.textAlign = design.textAlign;
  }

  function updateQrPosition() {
    var qr = $('preview-qr');
    var preview = $('card-preview');
    var pw = preview.offsetWidth, ph = preview.offsetHeight;
    qr.style.left = (design.qrX * pw) + 'px';
    qr.style.top = (design.qrY * ph) + 'px';
    qr.style.width = Math.min(design.qrSize, pw * 0.5) + 'px';
    qr.style.height = Math.min(design.qrSize, ph * 0.5) + 'px';
  }

  function updateTextPosition() {
    var text = $('preview-text');
    var preview = $('card-preview');
    var pw = preview.offsetWidth, ph = preview.offsetHeight;
    text.style.left = (design.textX * pw) + 'px';
    text.style.top = (design.textY * ph) + 'px';
  }

  // Drag handlers
  function startDrag(e, type) {
    e.preventDefault();
    var elem = type === 'qr' ? $('preview-qr') : $('preview-text');
    dragState.dragging = type;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.elemStartX = parseInt(elem.style.left) || 0;
    dragState.elemStartY = parseInt(elem.style.top) || 0;
  }

  function onDrag(e) {
    if (!dragState.dragging) return;
    e.preventDefault();
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    var elem = dragState.dragging === 'qr' ? $('preview-qr') : $('preview-text');
    var preview = $('card-preview');
    var newX = Math.max(0, Math.min(preview.offsetWidth - elem.offsetWidth, dragState.elemStartX + dx));
    var newY = Math.max(0, Math.min(preview.offsetHeight - elem.offsetHeight, dragState.elemStartY + dy));
    elem.style.left = newX + 'px';
    elem.style.top = newY + 'px';
  }

  function endDrag(e) {
    if (!dragState.dragging) return;
    var elem = dragState.dragging === 'qr' ? $('preview-qr') : $('preview-text');
    var preview = $('card-preview');
    if (dragState.dragging === 'qr') {
      design.qrX = parseInt(elem.style.left) / preview.offsetWidth;
      design.qrY = parseInt(elem.style.top) / preview.offsetHeight;
    } else {
      design.textX = parseInt(elem.style.left) / preview.offsetWidth;
      design.textY = parseInt(elem.style.top) / preview.offsetHeight;
    }
    dragState.dragging = null;
  }

  // Resize handler
  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    var qr = $('preview-qr');
    resizeState.resizing = true;
    resizeState.startX = e.clientX;
    resizeState.startY = e.clientY;
    resizeState.startW = qr.offsetWidth;
    resizeState.startH = qr.offsetHeight;
  }

  function onResize(e) {
    if (!resizeState.resizing) return;
    e.preventDefault();
    var dx = e.clientX - resizeState.startX;
    var qr = $('preview-qr');
    var newW = Math.max(50, resizeState.startW + dx);
    qr.style.width = newW + 'px';
    qr.style.height = newW + 'px';
  }

  function endResize(e) {
    if (!resizeState.resizing) return;
    var qr = $('preview-qr');
    design.qrSize = qr.offsetWidth;
    resizeState.resizing = false;
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', function() {
    // Create
    $('btn-create').addEventListener('click', openCreateDialog);
    $('btn-create-cancel').addEventListener('click', function() { hide($('create-dialog')); });
    $('btn-create-confirm').addEventListener('click', doCreate);
    $('btn-create-another').addEventListener('click', function() {
      $('create-form-view').style.display = '';
      $('create-result-view').style.display = 'none';
      $('create-dialog-title').textContent = 'Create Gift Card';
    });
    $('btn-create-close').addEventListener('click', function() { hide($('create-dialog')); });
    $('btn-copy-result-link').addEventListener('click', function() {
      copyToClipboard($('result-redemption-url').value);
    });

    // Design mode toggle
    $('create-design-mode').addEventListener('change', updateDesignPreview);

    // Template selector
    $('design-template').addEventListener('change', function() {
      design.template = this.value;
      $('upload-group').style.display = this.value === 'custom' ? '' : 'none';
      updateTemplateImage();
    });

    // Template upload
    $('btn-upload-template').addEventListener('click', function() {
      $('template-file-input').click();
    });
    $('template-file-input').addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        design.customTemplateData = ev.target.result;
        $('upload-status').textContent = 'Loaded: ' + file.name;
        updateTemplateImage();
      };
      reader.readAsDataURL(file);
    });

    // Design controls
    $('show-amount').addEventListener('change', function() { design.showAmount = this.checked; updateTextPreview(); });
    $('show-recipient').addEventListener('change', function() { design.showRecipient = this.checked; updateTextPreview(); });
    $('show-message').addEventListener('change', function() { design.showMessage = this.checked; updateTextPreview(); });
    $('design-font').addEventListener('change', function() { design.fontFamily = this.value; updateTextPreview(); });
    $('design-font-size').addEventListener('input', function() {
      design.fontSize = parseInt(this.value, 10);
      $('font-size-label').textContent = this.value;
      updateTextPreview();
    });
    $('design-font-color').addEventListener('input', function() { design.fontColor = this.value; updateTextPreview(); });
    $('design-bg-color').addEventListener('input', function() { design.bgColor = this.value; if (design.bgColorEnabled) updateTemplateImage(); });
    $('bg-color-enabled').addEventListener('change', function() { design.bgColorEnabled = this.checked; updateTemplateImage(); });

    // Alignment buttons
    document.querySelectorAll('.align-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.align-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        design.textAlign = btn.getAttribute('data-align');
        updateTextPreview();
      });
    });

    // Live preview updates
    $('create-amount').addEventListener('input', updateTextPreview);
    $('create-recipient-name').addEventListener('input', updateTextPreview);
    $('create-message').addEventListener('input', updateTextPreview);

    // Drag and drop
    var qrEl = $('preview-qr');
    var textEl = $('preview-text');
    var resizeHandle = $('resize-handle');
    qrEl.addEventListener('pointerdown', function(e) { startDrag(e, 'qr'); });
    textEl.addEventListener('pointerdown', function(e) { startDrag(e, 'text'); });
    document.addEventListener('pointermove', function(e) { onDrag(e); onResize(e); });
    document.addEventListener('pointerup', function(e) { endDrag(e); endResize(e); });
    resizeHandle.addEventListener('pointerdown', startResize);

    // Bulk
    $('btn-bulk-open').addEventListener('click', openBulkDialog);
    $('btn-bulk-cancel').addEventListener('click', function() { hide($('bulk-dialog')); });
    $('btn-bulk-create').addEventListener('click', doBulkCreate);
    document.querySelectorAll('[data-bulk-tab]').forEach(function(tab) {
      tab.addEventListener('click', function() { switchBulkTab(tab.getAttribute('data-bulk-tab')); });
    });

    // Bulk total hint
    $('bulk-count').addEventListener('input', updateBulkHint);
    $('bulk-amount').addEventListener('input', updateBulkHint);

    // CSV
    $('btn-csv-template').addEventListener('click', downloadCsvTemplate);
    $('csv-file-input').addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) parseCsvFile(file);
    });

    // Bulk actions
    $('btn-bulk-delete').addEventListener('click', bulkDelete);
    $('btn-bulk-csv').addEventListener('click', downloadCsv);
    $('btn-bulk-email').addEventListener('click', openBulkEmailDialog);
    $('btn-bulk-email-send').addEventListener('click', doBulkEmail);
    $('btn-bulk-email-close').addEventListener('click', function() { hide($('bulk-email-dialog')); });

    // Card dialog
    $('btn-card-close').addEventListener('click', function() { hide($('card-dialog')); });
    $('btn-download-image').addEventListener('click', downloadCardImage);
    $('btn-card-edit').addEventListener('click', function() {
      if (currentDetailCard) {
        hide($('card-dialog'));
        openEditDialog(currentDetailCard.id || currentDetailCard.cardId);
      }
    });
    $('btn-card-delete').addEventListener('click', function() {
      if (currentDetailCard) {
        hide($('card-dialog'));
        deleteCard(currentDetailCard.id || currentDetailCard.cardId);
      }
    });

    // Edit dialog
    $('btn-edit-cancel').addEventListener('click', function() { hide($('edit-dialog')); });
    $('btn-edit-save').addEventListener('click', doEdit);

    // Deliver
    $('btn-deliver-cancel').addEventListener('click', function() { hide($('deliver-dialog')); });
    $('btn-deliver-send').addEventListener('click', doDeliver);
    $('deliver-mode').addEventListener('change', updateDeliverMode);

    // Filters
    $('filter-status').addEventListener('change', loadCards);
    $('btn-search').addEventListener('click', loadCards);
    $('search-query').addEventListener('keydown', function(e) { if (e.key === 'Enter') loadCards(); });
    $('btn-clear-filters').addEventListener('click', function() {
      $('filter-status').value = '';
      $('search-query').value = '';
      loadCards();
    });

    // Pagination
    $('btn-prev-page').addEventListener('click', function() { if (currentPage > 1) { currentPage--; renderTable(); } });
    $('btn-next-page').addEventListener('click', function() { currentPage++; renderTable(); });

    // Load initial data
    loadCards();
  });

  function updateBulkHint() {
    var count = parseInt($('bulk-count').value, 10) || 0;
    var amount = parseInt($('bulk-amount').value, 10) || 0;
    $('bulk-total-hint').textContent = 'Total: ' + (count * amount).toLocaleString() + ' sats.';
  }
})();
