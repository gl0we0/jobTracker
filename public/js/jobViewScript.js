/// #############################################################///
// jobViewScript.js
// Handles job detail modal rendering, save lifecycle, and job-view controls.
/// #############################################################///

let activeJobNumber = null;
let activeJobIsNew = false;
let activeTimeline = [];
let activeTimelineLastEvent = null;
let activeInvoiceDraft = null;
let initialInvoiceSnapshot = '';
let hasUnsavedInvoiceChanges = false;
let activeJobFiles = [];
let initialFormSnapshot = '';
let hasUnsavedChanges = false;
let dirtyTrackingBound = false;
let dirtyTrackingContainer = null;
let cleanupViewportTracking = null;
let toolMessageBridgeBound = false;
const invoiceSheetPartialPath = './partials/invoiceSheet.html';

const stateCodeOverrides = {
    Invoiced: 'Vo'
};

function applyJobViewViewportVars() {
    const contentArea = document.getElementById('jobDetailsContent');
    if (!contentArea) {
        return;
    }

    const visualViewportRef = window.visualViewport;
    const viewportHeight = visualViewportRef ? Math.round(visualViewportRef.height) : window.innerHeight;
    const reservedChrome = 210;
    const notesMinHeight = Math.max(220, viewportHeight - reservedChrome);
    contentArea.style.setProperty('--job-mobile-vh', `${viewportHeight}px`);
    contentArea.style.setProperty('--job-notes-min-height', `${notesMinHeight}px`);
}

function bindJobViewViewportTracking() {
    if (cleanupViewportTracking) {
        cleanupViewportTracking();
    }

    let rafId = 0;
    const scheduleUpdate = () => {
        if (rafId) {
            return;
        }
        rafId = window.requestAnimationFrame(() => {
            rafId = 0;
            applyJobViewViewportVars();
        });
    };

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', scheduleUpdate);

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleUpdate);
        window.visualViewport.addEventListener('scroll', scheduleUpdate);
    }

    scheduleUpdate();

    cleanupViewportTracking = () => {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        window.removeEventListener('resize', scheduleUpdate);
        window.removeEventListener('orientationchange', scheduleUpdate);
        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', scheduleUpdate);
            window.visualViewport.removeEventListener('scroll', scheduleUpdate);
        }
        cleanupViewportTracking = null;
    };
}

function unbindJobViewViewportTracking() {
    if (cleanupViewportTracking) {
        cleanupViewportTracking();
    }
    const contentArea = document.getElementById('jobDetailsContent');
    if (contentArea) {
        contentArea.style.removeProperty('--job-mobile-vh');
        contentArea.style.removeProperty('--job-notes-min-height');
    }
}

function normalizeForComparison(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeForComparison);
    }
    if (value && typeof value === 'object') {
        const sortedKeys = Object.keys(value).sort();
        const normalized = {};
        sortedKeys.forEach(key => {
            normalized[key] = normalizeForComparison(value[key]);
        });
        return normalized;
    }
    return value;
}

function snapshotValue(value) {
    return JSON.stringify(normalizeForComparison(value));
}

function getJobFormInstance() {
    return $('#jobFormContainerOuter').alpaca('get');
}

function getSaveButton() {
    return document.getElementById('jobViewSaveButton');
}

function mountInvoiceSheetPartial(invoiceSheetHtml) {
    const mountPoint = document.getElementById('jobViewInvoiceSheetMount');
    if (!mountPoint) {
        return;
    }
    mountPoint.innerHTML = invoiceSheetHtml || '';
}

function cloneData(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
}

function hasPendingChanges() {
    return hasUnsavedChanges || hasUnsavedInvoiceChanges;
}

function updateSaveButtonState() {
    const saveButton = getSaveButton();
    if (!saveButton) {
        return;
    }
    const disabled = !hasPendingChanges();
    saveButton.disabled = disabled;
    saveButton.classList.toggle('is-disabled', disabled);
}

function setBaselineFromCurrentForm() {
    const form = getJobFormInstance();
    if (!form || typeof form.getValue !== 'function') {
        return;
    }
    initialFormSnapshot = snapshotValue(form.getValue());
    hasUnsavedChanges = false;
    updateSaveButtonState();
}

function setInvoiceBaseline(invoiceDraft) {
    initialInvoiceSnapshot = invoiceDraft ? snapshotValue(invoiceDraft) : '';
    hasUnsavedInvoiceChanges = false;
    updateSaveButtonState();
}

function refreshUnsavedState() {
    const form = getJobFormInstance();
    if (!form || typeof form.getValue !== 'function' || !initialFormSnapshot) {
        return;
    }
    const currentSnapshot = snapshotValue(form.getValue());
    hasUnsavedChanges = currentSnapshot !== initialFormSnapshot;
    const statusEl = document.getElementById('jobViewSaveStatus');
    if (hasPendingChanges()) {
        setSaveStatus('Unsaved changes', 'warning');
    } else if (statusEl && !statusEl.classList.contains('is-success')) {
        setSaveStatus('', null);
    }
    updateSaveButtonState();
    syncStateBadgeFromForm();
    syncColorButtonFromForm();
    updateSummaryFromForm();
}

function bindDirtyTracking() {
    const container = document.getElementById('jobFormContainerOuter');
    if (!container) {
        return;
    }
    if (dirtyTrackingBound && dirtyTrackingContainer === container) {
        return;
    }

    const handlePotentialChange = () => {
        refreshUnsavedState();
    };

    container.addEventListener('input', handlePotentialChange, true);
    container.addEventListener('change', handlePotentialChange, true);
    dirtyTrackingBound = true;
    dirtyTrackingContainer = container;
}

function setSaveStatus(message, tone) {
    const status = document.getElementById('jobViewSaveStatus');
    if (!status) {
        return;
    }
    status.textContent = message || '';
    status.classList.remove('is-saving', 'is-success', 'is-error', 'is-warning');
    if (tone) {
        status.classList.add(`is-${tone}`);
    }
}

function setUtilityStatus(id, message, tone) {
    const status = document.getElementById(id);
    if (!status) {
        return;
    }
    status.textContent = message || '';
    status.classList.remove('is-saving', 'is-success', 'is-error', 'is-warning');
    if (tone) {
        status.classList.add(`is-${tone}`);
    }
}

function updateJobViewHeading(jobNumber, name) {
    const heading = document.getElementById('jobViewNameLabel');
    if (!heading) {
        return;
    }
    const label = heading.querySelector('.jobViewNameLabelText');
    const text = `${jobNumber} - ${name}`;
    if (label) {
        label.textContent = text;
    } else {
        heading.textContent = text;
    }
}

function stateToCode(state) {
    if (!state) {
        return '--';
    }
    if (stateCodeOverrides[state]) {
        return stateCodeOverrides[state];
    }
    const lettersOnly = state.replace(/[^a-z]/gi, '');
    if (!lettersOnly) {
        return '--';
    }
    const raw = lettersOnly.slice(0, 2);
    return `${raw.charAt(0).toUpperCase()}${raw.charAt(1).toLowerCase()}`;
}

function getStateSelectField() {
    return document.querySelector('#jobViewStateField select');
}

function getColorInputField() {
    return document.querySelector('#jobViewColorField input[type="color"]');
}

function getCostInputField() {
    return document.querySelector('#jobViewCostDock input[type="text"]');
}

function appendToolSummaryToJobNotes(summaryText) {
    if (!summaryText || !summaryText.trim()) {
        return;
    }

    const notesInput = document.querySelector('#jobViewMiddle_NotesDrawer textarea');
    if (!notesInput) {
        return;
    }

    const existingText = (notesInput.value || '').trimEnd();
    const appendText = summaryText.trim();
    notesInput.value = existingText ? `${existingText}\n\n${appendText}` : appendText;
    notesInput.dispatchEvent(new Event('input', { bubbles: true }));
    notesInput.dispatchEvent(new Event('change', { bubbles: true }));
    notesInput.focus();
}

function bindCurtainPricingBridge() {
    if (toolMessageBridgeBound) {
        return;
    }

    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin) {
            return;
        }
        const data = event.data || {};
        if (!['curtainPricing:addToJobNotes', 'railBending:addToJobNotes'].includes(data.type)) {
            return;
        }
        appendToolSummaryToJobNotes(data.payload && data.payload.text ? data.payload.text : '');
    });

    toolMessageBridgeBound = true;
}

function syncStateBadgeFromForm() {
    const stateButton = document.getElementById('jobViewStateButton');
    const stateSelect = getStateSelectField();
    if (!stateButton || !stateSelect) {
        return;
    }
    stateButton.textContent = stateToCode(stateSelect.value);
    stateButton.title = stateSelect.value;
}

function syncColorButtonFromForm() {
    const colorButton = document.getElementById('jobViewColorButton');
    const colorInput = getColorInputField();
    if (!colorButton || !colorInput) {
        return;
    }
    colorButton.style.backgroundColor = colorInput.value || '#ffffff';
}

function updateSummaryFromForm() {
    const form = getJobFormInstance();
    if (!form || typeof form.getValue !== 'function') {
        return;
    }

    const value = form.getValue() || {};
    const name = value.customerDetails && value.customerDetails.name ? value.customerDetails.name : 'New Job';
    const jobNumber = value.jobNumber || activeJobNumber || 'new';
    updateJobViewHeading(jobNumber, name);
}

function updateTimelineMenuLabel() {
    const button = document.getElementById('jobViewTimelineMenuButton');
    if (!button) {
        return;
    }

    if (!activeTimelineLastEvent) {
        button.textContent = 'Timeline';
        return;
    }

    const timeLast = new Date(activeTimelineLastEvent.time);
    const formattedTime = Number.isNaN(timeLast.getTime())
        ? activeTimelineLastEvent.time
        : timeLast.toLocaleString('en-GB');
    button.textContent = `Timeline (${activeTimelineLastEvent.label} - ${formattedTime})`;
}

function getTodayDateValue() {
    return new Date().toISOString().slice(0, 10);
}

function toCurrencyNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.round(numeric * 100) / 100;
}

function formatCurrency(value) {
    return `£${toCurrencyNumber(value).toFixed(2)}`;
}

function buildInvoiceNumber(jobNumber) {
    return `inv${jobNumber}`;
}

function getCurrentJobFormValue() {
    const form = getJobFormInstance();
    if (!form || typeof form.getValue !== 'function') {
        return null;
    }
    return form.getValue() || {};
}

function buildPersistedJobValue(value) {
    const baseValue = cloneData(value || getCurrentJobFormValue() || {});
    if (activeInvoiceDraft) {
        baseValue.invoice = cloneData(activeInvoiceDraft);
    } else {
        delete baseValue.invoice;
    }
    return baseValue;
}

function calculateInvoiceTotals(invoiceDraft) {
    const lineItems = Array.isArray(invoiceDraft.lineItems) ? invoiceDraft.lineItems : [];
    let netTotal = 0;

    lineItems.forEach(item => {
        const qty = toCurrencyNumber(item.qty || 0);
        const unitCost = toCurrencyNumber(item.unitCost || 0);
        item.qty = qty;
        item.unitCost = unitCost;
        item.lineTotal = toCurrencyNumber(qty * unitCost);
        netTotal += item.lineTotal;
    });

    const vatRate = Number(invoiceDraft.vatRate);
    const safeVatRate = Number.isFinite(vatRate) ? vatRate : 0.2;
    const vatTotal = toCurrencyNumber(netTotal * safeVatRate);
    const grossTotal = toCurrencyNumber(netTotal + vatTotal);
    invoiceDraft.vatRate = safeVatRate;
    invoiceDraft.totals = {
        netTotal: toCurrencyNumber(netTotal),
        vatTotal,
        grossTotal
    };
    return invoiceDraft;
}

function createInvoiceDraftFromJob(jobValue) {
    const source = jobValue || {};
    const grossCost = Number(source.jobCost);
    const hasValidGross = Number.isFinite(grossCost);
    const seededNet = hasValidGross ? toCurrencyNumber(grossCost / 1.2) : 0;
    const jobNumber = source.jobNumber || activeJobNumber || '';
    const description = source.notes && source.notes.trim() ? source.notes.trim() : `Job ${jobNumber}`;

    return calculateInvoiceTotals({
        invoiceNumber: buildInvoiceNumber(jobNumber),
        issueDate: getTodayDateValue(),
        customerName: source.customerDetails && source.customerDetails.name ? source.customerDetails.name : '',
        customerAddress: source.customerDetails && source.customerDetails.address ? source.customerDetails.address : '',
        jobReference: jobNumber.toString(),
        company: {
            lineSmall: 'LoweCo LTD',
            lineLarge: 'Peter Lowe Fabrics'
        },
        vatRate: 0.2,
        notes: source.notes || '',
        lineItems: [
            {
                qty: 1,
                description,
                unitCost: seededNet,
                lineTotal: seededNet
            }
        ],
        totals: {
            netTotal: seededNet,
            vatTotal: toCurrencyNumber(seededNet * 0.2),
            grossTotal: toCurrencyNumber(seededNet * 1.2)
        },
        pdfFiles: [],
        updatedAt: new Date().toISOString()
    });
}

function ensureInvoiceDraft() {
    if (activeInvoiceDraft) {
        return activeInvoiceDraft;
    }

    const source = buildPersistedJobValue();
    activeInvoiceDraft = createInvoiceDraftFromJob(source);
    hasUnsavedInvoiceChanges = true;
    setSaveStatus('Unsaved changes', 'warning');
    updateSaveButtonState();
    return activeInvoiceDraft;
}

function markInvoiceDirty() {
    hasUnsavedInvoiceChanges = !initialInvoiceSnapshot || snapshotValue(activeInvoiceDraft) !== initialInvoiceSnapshot;
    if (hasPendingChanges()) {
        setSaveStatus('Unsaved changes', 'warning');
    }
    updateSaveButtonState();
}

function applyInvoiceDomToDraft() {
    const invoiceDraft = ensureInvoiceDraft();
    const customerNameInput = document.getElementById('invoiceCustomerName');
    const customerAddressInput = document.getElementById('invoiceCustomerAddress');
    const issueDateInput = document.getElementById('invoiceIssueDate');
    const jobReferenceInput = document.getElementById('invoiceJobReference');
    const invoiceNumberInput = document.getElementById('invoiceNumberInput');

    invoiceDraft.customerName = customerNameInput ? customerNameInput.value : invoiceDraft.customerName;
    invoiceDraft.customerAddress = customerAddressInput ? customerAddressInput.value : invoiceDraft.customerAddress;
    invoiceDraft.issueDate = issueDateInput ? issueDateInput.value : invoiceDraft.issueDate;
    invoiceDraft.jobReference = jobReferenceInput ? jobReferenceInput.value : invoiceDraft.jobReference;
    invoiceDraft.invoiceNumber = invoiceNumberInput ? invoiceNumberInput.value : invoiceDraft.invoiceNumber;
    invoiceDraft.updatedAt = new Date().toISOString();
    calculateInvoiceTotals(invoiceDraft);
    return invoiceDraft;
}

function renderInvoiceLineItems() {
    const invoiceDraft = ensureInvoiceDraft();
    const body = document.getElementById('invoiceLineItemsBody');
    if (!body) {
        return;
    }

    body.innerHTML = '';
    invoiceDraft.lineItems.forEach((item, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="number" min="0" step="1" class="invoiceTableInput" data-invoice-line-field="qty" data-line-index="${index}" value="${item.qty}"></td>
            <td><textarea class="invoiceTableTextarea" rows="3" data-invoice-line-field="description" data-line-index="${index}">${item.description || ''}</textarea></td>
            <td><input type="number" min="0" step="0.01" class="invoiceTableInput" data-invoice-line-field="unitCost" data-line-index="${index}" value="${toCurrencyNumber(item.unitCost)}"></td>
            <td><div class="invoiceLineTotal">${formatCurrency(item.lineTotal || 0)}</div></td>
            <td class="no-print"><button type="button" class="btn btn-link btn-sm" data-remove-line="${index}">Remove</button></td>
        `;
        body.appendChild(row);
    });

    Array.from(body.querySelectorAll('[data-invoice-line-field]')).forEach(input => {
        input.addEventListener('input', event => {
            const lineIndex = Number(event.target.getAttribute('data-line-index'));
            const field = event.target.getAttribute('data-invoice-line-field');
            const currentLine = invoiceDraft.lineItems[lineIndex];
            if (!currentLine) {
                return;
            }
            currentLine[field] = field === 'description' ? event.target.value : Number(event.target.value);
            calculateInvoiceTotals(invoiceDraft);
            markInvoiceDirty();
            syncInvoiceSummary();
            if (field !== 'description') {
                const row = event.target.closest('tr');
                const totalCell = row ? row.querySelector('.invoiceLineTotal') : null;
                if (totalCell) {
                    totalCell.textContent = formatCurrency(currentLine.lineTotal || 0);
                }
            }
        });
    });

    Array.from(body.querySelectorAll('[data-remove-line]')).forEach(button => {
        button.addEventListener('click', () => {
            const lineIndex = Number(button.getAttribute('data-remove-line'));
            invoiceDraft.lineItems.splice(lineIndex, 1);
            if (!invoiceDraft.lineItems.length) {
                invoiceDraft.lineItems.push({ qty: 1, description: '', unitCost: 0, lineTotal: 0 });
            }
            calculateInvoiceTotals(invoiceDraft);
            markInvoiceDirty();
            syncInvoiceSummary();
            renderInvoiceLineItems();
        });
    });
}

function syncInvoiceSummary() {
    const invoiceDraft = ensureInvoiceDraft();
    const invoiceNumberDisplay = document.getElementById('invoiceNumberDisplay');
    const netTotal = document.getElementById('invoiceNetTotal');
    const vatTotal = document.getElementById('invoiceVatTotal');
    const grossTotal = document.getElementById('invoiceGrossTotal');

    if (invoiceNumberDisplay) {
        invoiceNumberDisplay.textContent = invoiceDraft.invoiceNumber || buildInvoiceNumber(activeJobNumber || '');
    }
    if (netTotal) {
        netTotal.textContent = formatCurrency(invoiceDraft.totals && invoiceDraft.totals.netTotal || 0);
    }
    if (vatTotal) {
        vatTotal.textContent = formatCurrency(invoiceDraft.totals && invoiceDraft.totals.vatTotal || 0);
    }
    if (grossTotal) {
        grossTotal.textContent = formatCurrency(invoiceDraft.totals && invoiceDraft.totals.grossTotal || 0);
    }
}

function renderInvoiceDraft() {
    const invoiceDraft = ensureInvoiceDraft();
    const map = {
        invoiceCustomerName: invoiceDraft.customerName || '',
        invoiceCustomerAddress: invoiceDraft.customerAddress || '',
        invoiceIssueDate: invoiceDraft.issueDate || getTodayDateValue(),
        invoiceJobReference: invoiceDraft.jobReference || activeJobNumber || '',
        invoiceNumberInput: invoiceDraft.invoiceNumber || buildInvoiceNumber(activeJobNumber || '')
    };

    Object.keys(map).forEach(id => {
        const node = document.getElementById(id);
        if (node) {
            node.value = map[id];
        }
    });

    calculateInvoiceTotals(invoiceDraft);
    syncInvoiceSummary();
    renderInvoiceLineItems();
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderPrintText(value) {
    const safeValue = value == null ? '' : String(value);
    return escapeHtml(safeValue).replace(/\n/g, '<br>');
}

function getInvoiceFooterHtml(elementId, fallbackText) {
    const node = document.getElementById(elementId);
    if (node && node.innerHTML && node.innerHTML.trim()) {
        return node.innerHTML.trim();
    }
    return escapeHtml(fallbackText || '');
}

function getInvoicePrintMarkup(invoiceDraft) {
    const lineItems = Array.isArray(invoiceDraft.lineItems) ? invoiceDraft.lineItems : [];
    const rows = lineItems.map(item => `
        <tr>
            <td class="qty-col">${escapeHtml(item.qty)}</td>
            <td>${renderPrintText(item.description || '')}</td>
            <td class="money-col">${formatCurrency(item.unitCost || 0)}</td>
            <td class="money-col">${formatCurrency(item.lineTotal || 0)}</td>
        </tr>
    `).join('');
    const footerDetailsHtml = getInvoiceFooterHtml('invoiceFooterDetailsContent', 'business details');
    const footerBacsHtml = getInvoiceFooterHtml('invoiceFooterBacsContent', 'bacs details');
    const footerContactHtml = getInvoiceFooterHtml('invoiceFooterContactContent', 'contact details');

    return `
        <div class="invoiceDocument printInvoiceDocument">
            <div class="invoiceHeader">
                <div class="invoiceBrand">
                    <img src="/images/PLFLogo_sm.png" alt="Peter Lowe Fabrics" class="invoiceLogoImage">
                </div>
                <div class="invoiceTitleWrap">
                    <div class="invoiceTitle">Invoice</div>
                    <div class="invoiceNumber">${escapeHtml(invoiceDraft.invoiceNumber || buildInvoiceNumber(activeJobNumber || ''))}</div>
                </div>
            </div>

            <div class="invoiceMetaGrid">
                <div class="invoiceCustomerBlock">
                    <div class="invoiceLabel">Name</div>
                    <div class="invoicePrintField">${renderPrintText(invoiceDraft.customerName || '')}</div>
                    <div class="invoiceLabel">Address</div>
                    <div class="invoicePrintField invoicePrintMultiline">${renderPrintText(invoiceDraft.customerAddress || '')}</div>
                </div>
                <div class="invoiceInfoBlock">
                    <div class="invoiceLabel">Date</div>
                    <div class="invoicePrintField">${escapeHtml(invoiceDraft.issueDate || '')}</div>
                    <div class="invoiceLabel">Order</div>
                    <div class="invoicePrintField">${escapeHtml(invoiceDraft.jobReference || '')}</div>
                    <div class="invoiceLabel">Invoice No.</div>
                    <div class="invoicePrintField">${escapeHtml(invoiceDraft.invoiceNumber || '')}</div>
                </div>
            </div>

            <div class="invoiceTableWrap">
                <table class="invoiceTable">
                    <thead>
                        <tr>
                            <th class="invoiceQtyCol">Amt</th>
                            <th>Items</th>
                            <th class="invoiceCostCol">Cost</th>
                            <th class="invoiceTotalCol">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>

            <div class="invoiceSummaryGrid">
                <div class="invoiceFooterInfo">
                    <div class="invoiceFooterColumns">
                        <div class="invoiceFooterColumn">
                            <div class="invoiceFooterHeading">Details</div>
                            <div class="invoicePrintField invoicePrintMultiline">${footerDetailsHtml}</div>
                        </div>
                        <div class="invoiceFooterColumn">
                            <div class="invoiceFooterHeading">Bacs</div>
                            <div class="invoicePrintField invoicePrintMultiline">${footerBacsHtml}</div>
                        </div>
                    </div>
                </div>
                <div class="invoiceTotalsCard">
                    <div class="invoiceTotalsRow">
                        <span>Total</span>
                        <strong>${formatCurrency(invoiceDraft.totals && invoiceDraft.totals.netTotal || 0)}</strong>
                    </div>
                    <div class="invoiceTotalsRow">
                        <span>VAT @20%</span>
                        <strong>${formatCurrency(invoiceDraft.totals && invoiceDraft.totals.vatTotal || 0)}</strong>
                    </div>
                    <div class="invoiceTotalsRow invoiceTotalsRowGrand">
                        <span>Grand total</span>
                        <strong>${formatCurrency(invoiceDraft.totals && invoiceDraft.totals.grossTotal || 0)}</strong>
                    </div>
                </div>
                <div class="invoiceFooterContactBar">${footerContactHtml}</div>
            </div>
        </div>
    `;
}

function getInvoicePrintStyles() {
    return `
        @page { size: A4; margin: 10mm; }
        html, body { margin: 0; padding: 0; background: #ffffff; color: #1d2939; font-family: Arial, sans-serif; }
        * { box-sizing: border-box; }
        .printInvoiceDocument { width: 100%; border: none; border-radius: 0; padding: 0; margin: 0; font-size: 11pt;}
        .invoiceHeader { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 2px solid #d8e5f3; }
        .invoiceBrand { display: flex; align-items: flex-start; max-width: 58mm; }
        .invoiceLogoImage { display: block; width: 100%; height: auto; }
        .invoiceTitleWrap { text-align: right; }
        .invoiceTitle { font-size: 30pt; font-weight: 700; line-height: 1; }
        .invoiceNumber { margin-top: 6px; font-size: 11pt; font-weight: 600; color: #475467; }
        .invoiceMetaGrid, .invoiceSummaryGrid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(58mm, 1fr); gap: 12px; margin-top: 12px; }
        .invoiceSummaryGrid { margin-top: 12px; }
        .invoiceCustomerBlock, .invoiceInfoBlock, .invoiceTotalsCard, .invoiceFooterInfo { padding: 12px; border: 1px solid #d9e0e7; border-radius: 10px; background: #ffffff; break-inside: avoid; }
        .invoiceLabel, .invoiceFooterHeading { margin: 0 0 4px; font-size: 6.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #475467; }
        .invoicePrintField { min-height: 14px; margin: 0 0 10px; white-space: normal; word-break: break-word; }
        .invoicePrintMultiline { min-height: 48px; }
        .invoiceFooterColumns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .invoiceFooterColumn { min-width: 0; }
        .invoiceFooterContactBar { grid-column: 1 / -1; margin-top: 0; padding: 8px 12px; border: 1px solid #d9e0e7; border-radius: 10px; background: #ffffff; text-align: center; color: #475467; font-size: 8.5pt; font-weight: 600; }
        .invoiceTableWrap { margin-top: 12px; }
        .invoiceTable { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .invoiceTable th, .invoiceTable td { border: 1px solid #d9e0e7; padding: 8px; vertical-align: top; text-align: left; }
        .invoiceTable th { background: #eff5fb; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; }
        .invoiceQtyCol, .qty-col { width: 16mm; }
        .invoiceCostCol, .invoiceTotalCol, .money-col { width: 28mm; }
        .money-col { text-align: right; white-space: nowrap; }
        .invoiceTotalsRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #d9e0e7; }
        .invoiceTotalsRow:last-child { border-bottom: none; }
        .invoiceTotalsRowGrand { font-size: 12pt; }
    `;
}

function printInvoiceDraft() {
    const invoiceDraft = calculateInvoiceTotals(cloneData(applyInvoiceDomToDraft()));
    const printWindow = window.open('', '_blank', 'width=960,height=1280');
    if (!printWindow) {
        setUtilityStatus('jobViewInvoiceStatus', 'Allow pop-ups to print the invoice', 'error');
        return;
    }

    const documentMarkup = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${escapeHtml(invoiceDraft.invoiceNumber || 'Invoice')}</title>
            <style>${getInvoicePrintStyles()}</style>
        </head>
        <body>
            ${getInvoicePrintMarkup(invoiceDraft)}
        </body>
        </html>
    `;

    printWindow.document.open();
    printWindow.document.write(documentMarkup);
    printWindow.document.close();
    setUtilityStatus('jobViewInvoiceStatus', '', null);

    const triggerPrint = () => {
        printWindow.focus();
        printWindow.print();
        const closeAfterPrint = () => {
            printWindow.close();
        };
        if ('onafterprint' in printWindow) {
            printWindow.onafterprint = closeAfterPrint;
        } else {
            window.setTimeout(closeAfterPrint, 500);
        }
    };

    if (printWindow.document.readyState === 'complete') {
        window.setTimeout(triggerPrint, 50);
    } else {
        printWindow.onload = () => {
            window.setTimeout(triggerPrint, 50);
        };
    }
}

function getSheetState(button, sheet) {
    return {
        setOpen(open) {
            sheet.classList.toggle('open', open);
            sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
            if (button) {
                button.setAttribute('aria-expanded', open ? 'true' : 'false');
                button.classList.toggle('is-active', open);
            }
        }
    };
}

function updateUtilityButtonState() {
    const invoiceButton = document.getElementById('jobViewInvoiceButton');
    const filesButton = document.getElementById('jobViewFilesButton');
    const isDisabled = !activeJobNumber || activeJobNumber === 'new';
    if (invoiceButton) {
        invoiceButton.disabled = isDisabled;
        invoiceButton.classList.toggle('is-disabled', isDisabled);
    }
    if (filesButton) {
        filesButton.disabled = isDisabled;
        filesButton.classList.toggle('is-disabled', isDisabled);
    }
}

function renderFilesList() {
    const list = document.getElementById('jobViewFilesList');
    if (!list) {
        return;
    }

    if (!activeJobFiles.length) {
        list.innerHTML = '<p class="jobViewFilesEmpty">No files saved for this job yet.</p>';
        return;
    }

    list.innerHTML = '';
    activeJobFiles.forEach(file => {
        const row = document.createElement('div');
        row.className = 'jobViewFileRow';
        const link = `/jobs/${encodeURIComponent(activeJobNumber)}/files/${encodeURIComponent(file.name)}`;
        row.innerHTML = `
            <div class="jobViewFileMain">
                <a class="jobViewFileLink" href="${link}" target="_blank" rel="noopener noreferrer">${file.name}</a>
                <div class="jobViewFileMeta">${file.kind.toUpperCase()} | ${file.size} bytes | ${new Date(file.modifiedAt).toLocaleString('en-GB')}</div>
            </div>
        `;
        list.appendChild(row);
    });
}

function loadJobFiles() {
    if (!activeJobNumber || activeJobNumber === 'new') {
        return Promise.resolve([]);
    }

    setUtilityStatus('jobViewFilesStatus', 'Loading...', 'saving');
    return fetch(`/jobs/${activeJobNumber}/files`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load files: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            activeJobFiles = Array.isArray(data.files) ? data.files : [];
            renderFilesList();
            setUtilityStatus('jobViewFilesStatus', '', null);
            return activeJobFiles;
        })
        .catch(error => {
            console.error(error);
            activeJobFiles = [];
            renderFilesList();
            setUtilityStatus('jobViewFilesStatus', 'Failed to load files', 'error');
            return [];
        });
}

function uploadJobFile(file, options = {}) {
    if (!activeJobNumber || activeJobNumber === 'new') {
        return Promise.reject(new Error('Save the job before uploading files'));
    }

    if (!file) {
        return Promise.reject(new Error('No file selected'));
    }

    if (options.pdfOnly && file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        return Promise.reject(new Error('Please upload a PDF file'));
    }

    const formData = new FormData();
    formData.append('file', file);

    return fetch(`/jobs/${activeJobNumber}/files`, {
        method: 'POST',
        body: formData
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Upload failed with status ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            return loadJobFiles().then(() => data.file);
        });
}

function saveJobDetails(jobNumber, value) {
    const saveButton = getSaveButton();
    if (saveButton) {
        saveButton.disabled = true;
    }
    setSaveStatus('Saving...', 'saving');
    const persistedValue = buildPersistedJobValue(value);

    return fetch(`/jobs/${jobNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(persistedValue)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Save failed with status ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (activeJobNumber === 'new' && data.jobNumber) {
            activeJobNumber = data.jobNumber.toString();
            activeJobIsNew = false;
            persistedValue.jobNumber = activeJobNumber;
            updateJobViewHeading(
                activeJobNumber,
                persistedValue.customerDetails && persistedValue.customerDetails.name ? persistedValue.customerDetails.name : 'New Job'
            );
            if (activeInvoiceDraft && !activeInvoiceDraft.jobReference) {
                activeInvoiceDraft.jobReference = activeJobNumber;
                activeInvoiceDraft.invoiceNumber = buildInvoiceNumber(activeJobNumber);
            }
        }

        const effectiveJobNumber = activeJobNumber || jobNumber;
        const existingIndex = allJobs.findIndex(job => job.jobNumber.toString() === effectiveJobNumber.toString());
        const mergedJob = { ...persistedValue, jobNumber: effectiveJobNumber };
        if (existingIndex === -1) {
            allJobs.push(mergedJob);
        } else {
            allJobs[existingIndex] = mergedJob;
        }

        initialFormSnapshot = snapshotValue(mergedJob);
        hasUnsavedChanges = false;
        if (activeInvoiceDraft) {
            setInvoiceBaseline(activeInvoiceDraft);
        }
        updateSaveButtonState();
        setSaveStatus('Saved', 'success');
        updateUtilityButtonState();

        return fetch(`/jobs/${effectiveJobNumber}`)
            .then(res => res.ok ? res.json() : null)
            .then(savedJob => {
                if (!savedJob) {
                    return;
                }
                const idx = allJobs.findIndex(job => job.jobNumber.toString() === savedJob.jobNumber.toString());
                if (idx === -1) {
                    allJobs.push(savedJob);
                } else {
                    allJobs[idx] = savedJob;
                }

                activeTimeline = Array.isArray(savedJob.timeline) ? savedJob.timeline : [];
                activeTimelineLastEvent = activeTimeline.length ? activeTimeline[activeTimeline.length - 1] : null;
                activeInvoiceDraft = savedJob.invoice ? calculateInvoiceTotals(cloneData(savedJob.invoice)) : activeInvoiceDraft;

                initialFormSnapshot = snapshotValue(savedJob);
                hasUnsavedChanges = false;
                if (activeInvoiceDraft) {
                    setInvoiceBaseline(activeInvoiceDraft);
                }
                updateSaveButtonState();
                updateJobViewHeading(
                    savedJob.jobNumber,
                    savedJob.customerDetails && savedJob.customerDetails.name ? savedJob.customerDetails.name : 'New Job'
                );
                updateTimelineMenuLabel();
                if (activeTimeline.length) {
                    loadjobTimeline(activeTimeline);
                }
                syncStateBadgeFromForm();
                syncColorButtonFromForm();
                updateSummaryFromForm();
                updateUtilityButtonState();
                renderInvoiceDraft();
                loadJobFiles();
            });
    })
    .catch(error => {
        console.error('Error saving job details:', error);
        setSaveStatus('Save failed', 'error');
        updateSaveButtonState();
        throw error;
    });
}

function bindStateMenu() {
    const root = document.getElementById('jobDetailsContent');
    const stateButton = document.getElementById('jobViewStateButton');
    const stateMenu = document.getElementById('jobViewStateMenu');
    const stateSelect = getStateSelectField();

    if (!root || !stateButton || !stateMenu || !stateSelect) {
        return;
    }

    const closeMenu = () => {
        stateMenu.classList.remove('open');
        stateMenu.setAttribute('aria-hidden', 'true');
        stateButton.setAttribute('aria-expanded', 'false');
    };

    const openMenu = () => {
        stateMenu.classList.add('open');
        stateMenu.setAttribute('aria-hidden', 'false');
        stateButton.setAttribute('aria-expanded', 'true');
    };

    const buildMenu = () => {
        stateMenu.innerHTML = '';
        Array.from(stateSelect.options).forEach(option => {
            const menuButton = document.createElement('button');
            menuButton.type = 'button';
            menuButton.className = 'jobViewMenuItem';
            menuButton.textContent = option.text;
            if (option.value === stateSelect.value) {
                menuButton.classList.add('is-active');
            }
            menuButton.addEventListener('click', event => {
                event.stopPropagation();
                stateSelect.value = option.value;
                stateSelect.dispatchEvent(new Event('change', { bubbles: true }));
                syncStateBadgeFromForm();
                refreshUnsavedState();
                buildMenu();
                closeMenu();
            });
            stateMenu.appendChild(menuButton);
        });
    };

    buildMenu();

    stateButton.addEventListener('click', event => {
        event.stopPropagation();
        if (stateMenu.classList.contains('open')) {
            closeMenu();
        } else {
            buildMenu();
            openMenu();
        }
    });

    stateMenu.addEventListener('click', event => {
        event.stopPropagation();
    });

    root.addEventListener('click', closeMenu);
}

function bindOverflowMenu() {
    const root = document.getElementById('jobDetailsContent');
    const moreButton = document.getElementById('jobViewMoreButton');
    const moreMenu = document.getElementById('jobViewMoreMenu');
    const timelineButton = document.getElementById('jobViewTimelineMenuButton');

    if (!root || !moreButton || !moreMenu || !timelineButton) {
        return;
    }

    const closeMenu = () => {
        moreMenu.classList.remove('open');
        moreMenu.setAttribute('aria-hidden', 'true');
        moreButton.setAttribute('aria-expanded', 'false');
    };

    moreButton.addEventListener('click', event => {
        event.stopPropagation();
        const isOpen = moreMenu.classList.contains('open');
        if (isOpen) {
            closeMenu();
            return;
        }
        moreMenu.classList.add('open');
        moreMenu.setAttribute('aria-hidden', 'false');
        moreButton.setAttribute('aria-expanded', 'true');
    });

    moreMenu.addEventListener('click', event => {
        event.stopPropagation();
    });

    timelineButton.addEventListener('click', () => {
        closeMenu();
        $('#timelineModal').modal('show');
    });

    root.addEventListener('click', closeMenu);
}

function bindItemsSheet() {
    const itemsButton = document.getElementById('jobViewItemsButton');
    const sheet = document.getElementById('jobViewItemsSheet');
    if (!itemsButton || !sheet) {
        return;
    }

    const setSheetOpen = open => {
        sheet.classList.toggle('open', open);
        sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
        itemsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        itemsButton.classList.toggle('is-active', open);
    };

    itemsButton.addEventListener('click', () => {
        const isOpen = sheet.classList.contains('open');
        setSheetOpen(!isOpen);
    });

    Array.from(sheet.querySelectorAll('[data-items-sheet-close]')).forEach(node => {
        node.addEventListener('click', () => {
            setSheetOpen(false);
        });
    });
}

function bindInvoiceSheet() {
    const invoiceButton = document.getElementById('jobViewInvoiceButton');
    const sheet = document.getElementById('jobViewInvoiceSheet');
    const saveButton = document.getElementById('jobViewInvoiceSaveButton');
    const printButton = document.getElementById('jobViewInvoicePrintButton');
    const uploadButton = document.getElementById('jobViewInvoiceUploadPdfButton');
    const uploadInput = document.getElementById('jobViewInvoicePdfInput');
    const addLineButton = document.getElementById('invoiceAddLineButton');
    if (!invoiceButton || !sheet) {
        return;
    }

    const state = getSheetState(invoiceButton, sheet);
    const closeInvoiceSheet = () => state.setOpen(false);
    const openInvoiceSheet = () => {
        if (invoiceButton.disabled) {
            return;
        }
        ensureInvoiceDraft();
        renderInvoiceDraft();
        state.setOpen(true);
    };

    invoiceButton.addEventListener('click', openInvoiceSheet);
    Array.from(sheet.querySelectorAll('[data-invoice-sheet-close]')).forEach(node => {
        node.addEventListener('click', closeInvoiceSheet);
    });

    ['invoiceCustomerName', 'invoiceCustomerAddress', 'invoiceIssueDate', 'invoiceJobReference', 'invoiceNumberInput'].forEach(id => {
        const node = document.getElementById(id);
        if (!node) {
            return;
        }
        node.addEventListener('input', () => {
            applyInvoiceDomToDraft();
            markInvoiceDirty();
            syncInvoiceSummary();
        });
    });

    if (addLineButton) {
        addLineButton.addEventListener('click', () => {
            const invoiceDraft = ensureInvoiceDraft();
            invoiceDraft.lineItems.push({ qty: 1, description: '', unitCost: 0, lineTotal: 0 });
            calculateInvoiceTotals(invoiceDraft);
            markInvoiceDirty();
            syncInvoiceSummary();
            renderInvoiceLineItems();
        });
    }

    if (saveButton) {
        saveButton.addEventListener('click', () => {
            applyInvoiceDomToDraft();
            saveJobDetails(activeJobNumber, getCurrentJobFormValue()).then(() => {
                setUtilityStatus('jobViewInvoiceStatus', 'Saved', 'success');
            }).catch(() => {
                setUtilityStatus('jobViewInvoiceStatus', 'Save failed', 'error');
            });
        });
    }

    if (printButton) {
        printButton.addEventListener('click', () => {
            printInvoiceDraft();
        });
    }

    if (uploadButton && uploadInput) {
        uploadButton.addEventListener('click', () => uploadInput.click());
        uploadInput.addEventListener('change', () => {
            const file = uploadInput.files && uploadInput.files[0];
            setUtilityStatus('jobViewInvoiceStatus', 'Uploading...', 'saving');
            uploadJobFile(file, { pdfOnly: true })
                .then(uploadedFile => {
                    ensureInvoiceDraft();
                    if (!Array.isArray(activeInvoiceDraft.pdfFiles)) {
                        activeInvoiceDraft.pdfFiles = [];
                    }
                    if (!activeInvoiceDraft.pdfFiles.includes(uploadedFile.name)) {
                        activeInvoiceDraft.pdfFiles.push(uploadedFile.name);
                    }
                    activeInvoiceDraft.updatedAt = new Date().toISOString();
                    markInvoiceDirty();
                    return saveJobDetails(activeJobNumber, getCurrentJobFormValue());
                })
                .then(() => {
                    setUtilityStatus('jobViewInvoiceStatus', 'PDF uploaded', 'success');
                })
                .catch(error => {
                    console.error(error);
                    setUtilityStatus('jobViewInvoiceStatus', error.message || 'Upload failed', 'error');
                })
                .finally(() => {
                    uploadInput.value = '';
                });
        });
    }
}

function bindFilesSheet() {
    const filesButton = document.getElementById('jobViewFilesButton');
    const sheet = document.getElementById('jobViewFilesSheet');
    const uploadButton = document.getElementById('jobViewFilesUploadButton');
    const uploadInput = document.getElementById('jobViewFilesInput');
    if (!filesButton || !sheet) {
        return;
    }

    const state = getSheetState(filesButton, sheet);
    filesButton.addEventListener('click', () => {
        if (filesButton.disabled) {
            return;
        }
        state.setOpen(true);
        loadJobFiles();
    });

    Array.from(sheet.querySelectorAll('[data-files-sheet-close]')).forEach(node => {
        node.addEventListener('click', () => state.setOpen(false));
    });

    if (uploadButton && uploadInput) {
        uploadButton.addEventListener('click', () => uploadInput.click());
        uploadInput.addEventListener('change', () => {
            const file = uploadInput.files && uploadInput.files[0];
            setUtilityStatus('jobViewFilesStatus', 'Uploading...', 'saving');
            uploadJobFile(file)
                .then(() => {
                    setUtilityStatus('jobViewFilesStatus', 'Uploaded', 'success');
                })
                .catch(error => {
                    console.error(error);
                    setUtilityStatus('jobViewFilesStatus', error.message || 'Upload failed', 'error');
                })
                .finally(() => {
                    uploadInput.value = '';
                });
        });
    }
}

function bindSummaryToggle() {
    const summaryButton = document.getElementById('jobViewNameLabel');
    const customerPanel = document.getElementById('jobViewMiddle_CustomerDrawer');
    const notesDrawer = document.getElementById('jobViewMiddle_NotesDrawer');
    if (!summaryButton || !customerPanel) {
        return;
    }

    const setExpanded = expanded => {
        summaryButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        customerPanel.classList.toggle('open', expanded);
    };

    const updateRequiredFieldHighlighting = () => {
        const watchedFields = Array.from(customerPanel.querySelectorAll('.jobViewName input, .jobViewPhoneNumber input'));
        watchedFields.forEach(input => {
            const hasContent = input.value && input.value.trim().length > 0;
            input.classList.toggle('jobViewFieldEmpty', !hasContent);
        });
    };

    setExpanded(activeJobIsNew);
    updateRequiredFieldHighlighting();
    summaryButton.addEventListener('click', () => {
        const expanded = summaryButton.getAttribute('aria-expanded') === 'true';
        setExpanded(!expanded);
    });

    if (notesDrawer) {
        notesDrawer.addEventListener('click', () => {
            setExpanded(false);
        });
        notesDrawer.addEventListener('focusin', () => {
            setExpanded(false);
        });
    }

    Array.from(customerPanel.querySelectorAll('.jobViewName input, .jobViewPhoneNumber input')).forEach(input => {
        input.addEventListener('input', updateRequiredFieldHighlighting);
        input.addEventListener('change', updateRequiredFieldHighlighting);
    });
}

function focusCustomerNameForNewJob() {
    if (!activeJobIsNew) {
        return;
    }

    const nameInput = document.querySelector('#jobViewMiddle_CustomerDrawer .jobViewName input');
    if (!nameInput) {
        return;
    }

    window.requestAnimationFrame(() => {
        nameInput.focus();
        nameInput.select();
    });
}

function bindTopBarActions() {
    const backButton = document.getElementById('jobViewBackButton');
    const saveButton = document.getElementById('jobViewSaveButton');
    const colorButton = document.getElementById('jobViewColorButton');

    if (backButton) {
        backButton.addEventListener('click', () => {
            closeModal();
        });
    }

    if (saveButton) {
        saveButton.addEventListener('click', () => {
            if (!hasPendingChanges()) {
                return;
            }
            const form = getJobFormInstance();
            if (!form || typeof form.getValue !== 'function') {
                return;
            }
            saveJobDetails(activeJobNumber, form.getValue()).catch(() => {
                // Keep modal open when save fails.
            });
        });
    }

    if (colorButton) {
        colorButton.addEventListener('click', () => {
            const colorInput = getColorInputField();
            if (colorInput) {
                colorInput.click();
            }
        });
    }
}

function setupJobViewChrome() {
    bindCurtainPricingBridge();
    bindTopBarActions();
    bindSummaryToggle();
    bindStateMenu();
    bindOverflowMenu();
    bindItemsSheet();
    bindInvoiceSheet();
    bindFilesSheet();
    focusCustomerNameForNewJob();

    updateTimelineMenuLabel();
    syncStateBadgeFromForm();
    syncColorButtonFromForm();
    updateSummaryFromForm();
    updateUtilityButtonState();

    const costInput = getCostInputField();
    if (costInput) {
        costInput.setAttribute('inputmode', 'decimal');
        costInput.setAttribute('placeholder', 'Cost');
    }
}

function loadForm() {
    document.getElementById('jobFormContainerOuter').innerHTML = '';
    Promise.all([
        fetch('./alpaca/jobSchema.json').then(res => res.json()),
        fetch('./alpaca/schemaOptions.json').then(res => res.json()),
        fetch(invoiceSheetPartialPath).then(res => {
            if (!res.ok) {
                throw new Error(`Failed to load invoice sheet partial: ${res.status}`);
            }
            return res.text();
        })
    ]).then(([schema, options, invoiceSheetHtml]) => {
        $('#jobFormContainerOuter').alpaca({
            schema: schema,
            options: {
                ...options,
                form: {
                    buttons: {
                        submit: {
                            title: 'Save Job',
                            click: function() {
                                const value = this.getValue();
                                saveJobDetails(activeJobNumber, value);
                            }
                        }
                    }
                }
            },
            view: {
                parent: 'bootstrap-edit-horizontal',
                layout: {
                    template: './alpaca/jobTemplate.html',
                    bindings: schemaBindings()
                }
            },
            dataSource: activeJobNumber === 'new' ? {} : `./jobs/${activeJobNumber}`,
            postRender: function() {
                mountInvoiceSheetPartial(invoiceSheetHtml);
                bindDirtyTracking();
                setBaselineFromCurrentForm();
                setupJobViewChrome();
            }
        });
    }).catch(error => {
        console.error('Error loading form resources:', error);
    });
}

function showJobDetails(jobNumber) {
    const modal = document.getElementById('jobDetailsPopup');
    const contentArea = document.getElementById('jobDetailsContent');
    let job = [];
    let currentJobName = 'New Job';
    let JobBgColor = '#fff';
    let jobLastTime = null;
    let isJob = false;

    activeJobNumber = jobNumber.toString();
    activeJobIsNew = jobNumber === 'new';
    activeTimeline = [];
    activeTimelineLastEvent = null;
    activeInvoiceDraft = null;
    initialInvoiceSnapshot = '';
    hasUnsavedInvoiceChanges = false;
    activeJobFiles = [];
    initialFormSnapshot = '';
    hasUnsavedChanges = false;
    dirtyTrackingBound = false;
    dirtyTrackingContainer = null;

    if (jobNumber !== 'new') {
        job = allJobs.find(j => j.jobNumber.toString() === jobNumber.toString());
        if (!job) {
            console.error('Job not found');
            contentArea.innerHTML = '<p>Job not found.</p>';
            return;
        }
        currentJobName = job.customerDetails.name;
        JobBgColor = job.colorPick;
        if (job.timeline && job.timeline.length > 0) {
            jobLastTime = job.timeline[job.timeline.length - 1];
            activeTimeline = job.timeline;
            activeTimelineLastEvent = jobLastTime;
        }
        activeInvoiceDraft = job.invoice ? calculateInvoiceTotals(cloneData(job.invoice)) : null;
        initialInvoiceSnapshot = activeInvoiceDraft ? snapshotValue(activeInvoiceDraft) : '';
        isJob = true;
    }

    fetch('job-view')
        .then(response => response.text())
        .then(html => {
            contentArea.innerHTML = html;
            if (typeof window.initializeCurtainPanels === 'function') {
                window.initializeCurtainPanels(contentArea);
            }
            modal.style.display = 'block';
            modal.style.backgroundColor = 'rgba(241, 243, 245, 0.96)';
            contentArea.style.setProperty('--job-accent', JobBgColor || '#7f8c8d');
            bindJobViewViewportTracking();
            loadForm();

            if (isJob && jobLastTime) {
                loadjobTimeline(job.timeline);
            }

            updateJobViewHeading(jobNumber, currentJobName);
        })
        .catch(error => {
            console.error('Failed to load the job view:', error);
            contentArea.innerHTML = '<p>Error loading the job details.</p>';
        });
}

function loadjobTimeline(timeline) {
    const jobViewTimeLine = document.getElementById('jobViewTimeLine');
    if (!jobViewTimeLine) {
        return;
    }

    jobViewTimeLine.innerHTML = '';
    timeline.slice().reverse().forEach(event => {
        const eventDate = new Date(event.time);
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        const formattedTime = Number.isNaN(eventDate.getTime())
            ? event.time
            : eventDate.toLocaleString('en-GB');
        listItem.textContent = `${event.label} - ${formattedTime}`;
        jobViewTimeLine.appendChild(listItem);
    });
}

function closeModal() {
    const closeAndRefresh = () => {
        unbindJobViewViewportTracking();
        document.getElementById('jobDetailsPopup').style.display = 'none';
        document.body.classList.remove('jobViewPrintingInvoice');
        fetchJobs();
    };

    if (!hasPendingChanges()) {
        closeAndRefresh();
        return;
    }

    promptUnsavedCloseDecision().then(decision => {
        if (decision === 'save') {
            const form = getJobFormInstance();
            if (!form || typeof form.getValue !== 'function') {
                closeAndRefresh();
                return;
            }
            saveJobDetails(activeJobNumber, form.getValue())
                .then(() => {
                    closeAndRefresh();
                })
                .catch(() => {
                    // Keep modal open on failed save.
                });
            return;
        }

        if (decision === 'discard') {
            closeAndRefresh();
        }
    });
}

function promptUnsavedCloseDecision() {
    return new Promise(resolve => {
        const modal = $('#jobUnsavedModal');
        if (!modal.length) {
            resolve('cancel');
            return;
        }

        let decision = 'cancel';
        const saveButton = $('#jobUnsavedSaveButton');
        const discardButton = $('#jobUnsavedDiscardButton');
        const cancelButton = $('#jobUnsavedCancelButton');

        const cleanup = () => {
            saveButton.off('click.jobUnsaved');
            discardButton.off('click.jobUnsaved');
            cancelButton.off('click.jobUnsaved');
            modal.off('hidden.bs.modal.jobUnsaved');
        };

        saveButton.on('click.jobUnsaved', () => {
            decision = 'save';
            modal.modal('hide');
        });

        discardButton.on('click.jobUnsaved', () => {
            decision = 'discard';
            modal.modal('hide');
        });

        cancelButton.on('click.jobUnsaved', () => {
            decision = 'cancel';
        });

        modal.on('hidden.bs.modal.jobUnsaved', () => {
            cleanup();
            resolve(decision);
        });

        modal.modal('show');
    });
}

function schemaBindings() {
    return {
        customerDetails: 'jobViewMiddle_CustomerDrawer',
        notes: 'jobViewMiddle_NotesDrawer',
        jobState: 'jobViewStateField',
        orderItems: 'jobViewMiddle_ItemsDrawer',
        timeline: 'jobViewTimelineField',
        invoice: 'jobViewHiddenInvoice',
        jobCost: 'jobViewCostDock',
        colorPick: 'jobViewColorField',
        jobNumber: 'jobViewHiddenJobNumber'
    };
}
