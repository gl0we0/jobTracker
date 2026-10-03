document.addEventListener('DOMContentLoaded', function() {
    loadCollapsedStates();
    createJobColumns();
    fetchJobs();
    setupSearch();
    setupCalendarModal();
    setupStatePickerOverlay();
    setupStatsDashboard();
    setupCopyCsvMenu();
    //refresh button
    const refreshButton = document.getElementById('refreshButton');
    refreshButton.addEventListener('click', function() {
        this.disabled = true; // Disable the button to prevent multiple clicks
        this.style.opacity = '0.4'; // Fade out the button to indicate it is disabled
        fetchJobs().finally(() => {
            this.disabled = false; // Re-enable the button
            this.style.opacity = ''; // Reset the opacity
        });
    });

    document.getElementById('clipboardButton').addEventListener('click', function() {   
            const jobsWithOrderItems = allJobs.filter(job => Array.isArray(job.orderItems) && job.orderItems.length > 0);
            resetOrderItemFilters();
            displayOrderItems(jobsWithOrderItems);
            $('#orderItemsModal').modal('show'); // Use Bootstrap's JavaScript method to show the modal  
    });


    document.getElementById('createJobButton').addEventListener("click", function() {
      //alert("create new job");
     showJobDetails("new")
    });

    document.getElementById('sortSelect').addEventListener('change', function() {
        displayOrderItems(allJobs); // Redraw the table with the new sort order
    });
    
    document.getElementById('orderStatusUnorderedBtn').addEventListener('click', function() {
        setOrderStatusFilter('unordered');
        displayOrderItems(allJobs);
    });

    document.getElementById('orderStatusOrderedBtn').addEventListener('click', function() {
        setOrderStatusFilter('ordered');
        displayOrderItems(allJobs);
    });

    document.getElementById('includeDeliveredToggle').addEventListener('change', function() {
        displayOrderItems(allJobs); // Redraw the table to include/exclude delivered items
    });

    document.getElementById('jobSearch').addEventListener('input', function() {
        var clearButton = document.getElementById('clearSearch');
        if (this.value.length > 0) {
            clearButton.style.visibility = 'visible';
        } else {
            clearButton.style.visibility = 'hidden';
        }
    });
    
    document.getElementById('clearSearch').addEventListener('click', function() {
        var input = document.getElementById('jobSearch');
        input.value = '';
        input.focus(); // Optional: Refocus on the input after clearing
        this.style.visibility = 'hidden';
        displayJobs(allJobs);
    });

    setOrderStatusFilter('unordered');
});

let allJobs = []; // This will store all jobs fetched
let draggedJobNumber = null;
let suppressCardClick = false;
let longPressTimer = null;
let longPressTriggered = false;
const longPressDurationMs = 500;
const collapsedStateStorageKey = 'jobtracker.collapsedStates';
let collapsedStates = new Set();
let statsPipelineChart = null;
let statsFlowChart = null;
let statsSupplyChart = null;
let orderStatusFilter = 'unordered';
let activeOrderChipTooltip = null;
let activeOrderChipAnchor = null;
const calendarMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const calendarToday = new Date();
let calendarState = {
    viewYear: calendarToday.getFullYear(),
    viewMonth: calendarToday.getMonth(),
    selectedDate: '',
    expandedEntryId: '',
    mobileDayPanelOpen: false,
    days: {},
    updatedAt: '',
    loading: false,
    savingDate: ''
};



function fetchJobs() {
    return fetch('/jobs')
        .then(response => response.json())
        .then(jobs => {
            allJobs = jobs; // Store fetched jobs globally
            displayJobs(jobs); // Display all jobs initially
        })
        .catch(error => console.error('Error fetching jobs:', error));
}

function setupCopyCsvMenu() {
    const copyOngoingButton = document.getElementById('copyOngoingCsv');
    const copyCompleteButton = document.getElementById('copyCompleteCsv');

    if (copyOngoingButton) {
        copyOngoingButton.addEventListener('click', async function(event) {
            event.preventDefault();
            const { csv, count } = buildOngoingJobsCsv(allJobs);
            try {
                await copyTextToClipboard(csv);
                alert(`Copied ongoing CSV (${count} jobs).`);
            } catch (error) {
                console.error('Failed to copy ongoing CSV:', error);
                alert('Failed to copy ongoing CSV.');
            }
        });
    }

    if (copyCompleteButton) {
        copyCompleteButton.addEventListener('click', async function(event) {
            event.preventDefault();
            const { csv, count } = buildCompletedJobsCsv(allJobs);
            try {
                await copyTextToClipboard(csv);
                alert(`Copied complete CSV (${count} jobs).`);
            } catch (error) {
                console.error('Failed to copy complete CSV:', error);
                alert('Failed to copy complete CSV.');
            }
        });
    }
}

function buildOngoingJobsCsv(jobs) {
    const ongoingStates = new Set(["Going Ahead", "Materials Ordered", "Making", "Fitting"]);
    const rows = jobs
        .filter(job => ongoingStates.has(job.jobState))
        .map(job => ({
            jobNumber: job.jobNumber || '',
            customer: job.customerDetails && job.customerDetails.name ? job.customerDetails.name : '',
            state: job.jobState || '',
            startDate: toIsoDate(getEarliestValidTimelineDate(job.timeline))
        }));

    const headers = ["jobNumber", "customer", "state", "startDate"];
    return {
        csv: rowsToCsv(headers, rows),
        count: rows.length
    };
}

function buildCompletedJobsCsv(jobs) {
    const completedStates = new Set(["Invoiced", "Completed", "Archived"]);
    const rows = jobs
        .filter(job => completedStates.has(job.jobState))
        .map(job => {
            const startDate = toIsoDate(getEarliestValidTimelineDate(job.timeline));
            const invoicedEntry = Array.isArray(job.timeline)
                ? job.timeline.find(entry => {
                    const label = entry && typeof entry.label === 'string' ? entry.label.toLowerCase() : '';
                    const hasTime = entry && entry.time;
                    return hasTime && label.includes('invoiced');
                })
                : null;
            const invoicedDate = toIsoDate(toValidDate(invoicedEntry && invoicedEntry.time));

            return {
                jobNumber: job.jobNumber || '',
                startDate,
                invoicedDate,
                jobCost: job.jobCost || ''
            };
        });

    const headers = ["jobNumber", "startDate", "invoicedDate", "jobCost"];
    return {
        csv: rowsToCsv(headers, rows),
        count: rows.length
    };
}

function getEarliestValidTimelineDate(timeline) {
    if (!Array.isArray(timeline)) {
        return null;
    }

    return timeline.reduce((earliest, entry) => {
        const currentDate = toValidDate(entry && entry.time);
        if (!currentDate) {
            return earliest;
        }
        if (!earliest || currentDate < earliest) {
            return currentDate;
        }
        return earliest;
    }, null);
}

function toValidDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date) {
    return date ? date.toISOString().split('T')[0] : '';
}

function rowsToCsv(headers, rows) {
    const headerRow = headers.join(',');
    const dataRows = rows.map(row => {
        return headers.map(header => {
            const value = row[header] == null ? '' : String(row[header]);
            return `"${value.replace(/"/g, '""')}"`;
        }).join(',');
    });
    return [headerRow].concat(dataRows).join('\n');
}

function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        textArea.style.pointerEvents = 'none';
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, textArea.value.length);

        try {
            const succeeded = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (succeeded) {
                resolve();
                return;
            }
            reject(new Error('document.execCommand(copy) returned false'));
        } catch (error) {
            document.body.removeChild(textArea);
            reject(error);
        }
    });
}

function displayJobs(jobs) {
    const stateCounts = getStateCounts(jobs);

    jobStates.forEach(state => {
        const column = document.getElementById(state);
        column.innerHTML = '';
        const collapsed = isStateCollapsed(state);
        column.classList.toggle('collapsed', collapsed);
        if (collapsed) {
            column.classList.remove('expanded');
        }

        const header = renderColumnHeader(state, stateCounts[state] || 0, column);
        column.appendChild(header);
    });

    jobs.forEach(job => {
        addJobToColumn(job);
    });
    populateSupplierDropdown(allJobs);
}

function setOrderStatusFilter(status) {
    orderStatusFilter = status === 'ordered' ? 'ordered' : 'unordered';

    const unorderedButton = document.getElementById('orderStatusUnorderedBtn');
    const orderedButton = document.getElementById('orderStatusOrderedBtn');

    unorderedButton.classList.toggle('is-active', orderStatusFilter === 'unordered');
    orderedButton.classList.toggle('is-active', orderStatusFilter === 'ordered');
}

function resetOrderItemFilters() {
    const supplierFilter = document.getElementById('supplierFilter');
    const sortSelect = document.getElementById('sortSelect');
    const includeDeliveredToggle = document.getElementById('includeDeliveredToggle');

    if (sortSelect) {
        sortSelect.value = 'supplier';
    }
    if (supplierFilter) {
        supplierFilter.value = '';
    }
    if (includeDeliveredToggle) {
        includeDeliveredToggle.checked = false;
    }
    setOrderStatusFilter('unordered');
}

function renderColumnHeader(state, stateCount, column) {
    const header = document.createElement('div');
    header.className = "jobColumnHeader";
    header.addEventListener('click', function() {
        toggleStateCollapsed(state);
    });

    const title = document.createElement('span');
    title.className = 'jobColumnTitle';
    title.textContent = state;

    const count = document.createElement('span');
    count.className = 'jobColumnCount';
    count.textContent = stateCount.toString();

    const controls = document.createElement('div');
    controls.className = 'jobColumnControls';

    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.className = 'jobColumnCollapseButton';
    const isExpanded = column.classList.contains('expanded');
    collapseButton.innerHTML = isExpanded
        ? '<span class="glyphicon glyphicon-chevron-down" aria-hidden="true"></span>'
        : '<span class="glyphicon glyphicon-fullscreen" aria-hidden="true"></span>';
    collapseButton.setAttribute('aria-label', isExpanded ? `Restore ${state}` : `Maximize ${state}`);
    collapseButton.title = isExpanded ? `Restore ${state}` : `Maximize ${state}`;
    collapseButton.addEventListener('click', function(event) {
        event.stopPropagation();
        if (isStateCollapsed(state)) {
            setStateCollapsed(state, false);
        }
        toggleColumnWidth(column);
        displayJobs(allJobs);
    });

    controls.appendChild(collapseButton);
    header.appendChild(title);
    header.appendChild(count);
    header.appendChild(controls);

    return header;
}

function getStateCounts(jobs) {
    const counts = {};
    jobStates.forEach(state => {
        counts[state] = 0;
    });
    jobs.forEach(job => {
        if (counts[job.jobState] !== undefined) {
            counts[job.jobState] += 1;
        }
    });
    return counts;
}

function setupSearch() {
    const searchInput = document.getElementById('jobSearch');
    searchInput.addEventListener('keyup', function() {
        const searchText = this.value.toLowerCase();
        const filteredJobs = allJobs.filter(job => job.jobNumber.toString().toLowerCase().includes(searchText) ||
            job.customerDetails.name.toLowerCase().includes(searchText) ||
            job.jobState.toLowerCase().includes(searchText) ||
            job.notes.toLowerCase().includes(searchText));
        //const filteredJobs = allJobs.filter(job => JSON.stringify(job).includes(searchText));
        displayJobs(filteredJobs);
    });
}


const jobStates = ["Initial", "Measuring", "Needs Quote", "Quoted", "Going Ahead", "Materials Ordered", "Making", "Fitting", "Invoiced", "Completed", "Rejected", "Archived"];

function createJobColumns() {
    const container = document.getElementById('jobColumns'); // Get the container

    jobStates.forEach(state => {
        const column = document.createElement('div'); // Create a new div for each job state
        column.className = 'jobColumn'; // Set the class name for styling
        column.id = state; // Set the id to the job state
        setupJobColumnDropzone(column);

        container.appendChild(column);
    });
}

function loadCollapsedStates() {
    try {
        const raw = localStorage.getItem(collapsedStateStorageKey);
        if (!raw) {
            collapsedStates = new Set();
            return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            collapsedStates = new Set(parsed.filter(state => jobStates.includes(state)));
        }
    } catch (error) {
        console.warn('Failed to load collapsed states:', error);
        collapsedStates = new Set();
    }
}

function saveCollapsedStates() {
    localStorage.setItem(collapsedStateStorageKey, JSON.stringify(Array.from(collapsedStates)));
}

function isStateCollapsed(state) {
    return collapsedStates.has(state);
}

function toggleStateCollapsed(state) {
    setStateCollapsed(state, !isStateCollapsed(state));
}

function setStateCollapsed(state, collapsed) {
    if (collapsedStates.has(state)) {
        if (!collapsed) {
            collapsedStates.delete(state);
        }
    } else if (collapsed) {
        collapsedStates.add(state);
    }
    saveCollapsedStates();
    displayJobs(allJobs);
}

function addJobToColumn(job) {
    const column = document.getElementById(job.jobState);
    if (column) {
        const jobCard = document.createElement('div');
        jobCard.className = 'jobCard';
        jobCard.dataset.jobNumber = job.jobNumber; // Use dataset for custom data attributes
        jobCard.draggable = true;
        jobCard.style.backgroundColor = job.colorPick;
        jobCard.addEventListener("click", function() {
            if (suppressCardClick) {
                suppressCardClick = false;
                return;
            }
            showJobDetails(this.dataset.jobNumber);
        });
        jobCard.addEventListener('dragstart', function(event) {
            draggedJobNumber = this.dataset.jobNumber.toString();
            suppressCardClick = true;
            this.classList.add('dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', draggedJobNumber);
            }
        });
        jobCard.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            draggedJobNumber = null;
            clearColumnDragState();
            setTimeout(() => {
                suppressCardClick = false;
            }, 0);
        });
        jobCard.addEventListener('touchstart', function(event) {
            handleCardLongPressStart(event, this.dataset.jobNumber);
        }, { passive: true });
        jobCard.addEventListener('touchend', handleCardLongPressEnd, { passive: true });
        jobCard.addEventListener('touchcancel', handleCardLongPressEnd, { passive: true });
        jobCard.addEventListener('touchmove', handleCardLongPressEnd, { passive: true });

        // Get the last update date from the job's timeline
        const lastUpdate = job.timeline && job.timeline.length > 0 ? new Date(job.timeline[job.timeline.length - 1].time) : new Date();
        const color = getColorForLastUpdate(lastUpdate);
        const orderSummary = getJobOrderSummary(job);

        const title = document.createElement('span');
        title.className = 'jobCardTitle';
        title.textContent = job.customerDetails && job.customerDetails.name ? job.customerDetails.name : '';

        const note = document.createElement('div');
        note.className = 'jobCardNote';
        note.textContent = job.notes || '';

        const footer = document.createElement('div');
        footer.className = 'jobCardFooter';
        footer.style.backgroundColor = color;
        footer.textContent = job.jobNumber || '';

        if (orderSummary) {
            footer.appendChild(createJobOrderChip(orderSummary));
        }

        jobCard.appendChild(title);
        jobCard.appendChild(note);
        jobCard.appendChild(footer);
        column.appendChild(jobCard);
    }
}

function getJobOrderSummary(job) {
    const items = Array.isArray(job.orderItems) ? job.orderItems.filter(Boolean) : [];
    if (items.length === 0) {
        return null;
    }

    const arrivedCount = items.filter(item => Boolean(item.delivered)).length;
    const orderedOnlyCount = items.filter(item => Boolean(item.ordered) && !item.delivered).length;
    const pendingCount = items.filter(item => !item.ordered).length;
    let status = 'ordered';

    if (arrivedCount === items.length) {
        status = 'arrived';
    } else if (pendingCount === items.length) {
        status = 'pending-all';
    } else if (pendingCount > 0) {
        status = 'pending-partial';
    }

    return {
        totalCount: items.length,
        orderedCount: orderedOnlyCount,
        pendingCount,
        arrivedCount,
        status,
        tooltipLines: items.map(item => {
            let state = 'To order';
            if (item.delivered) {
                state = 'Arrived';
            } else if (item.ordered) {
                state = 'Ordered';
            }
            const label = item.item || item.note || item.itemType || 'Unnamed item';
            return `${state}: ${label}`;
        })
    };
}

function createJobOrderChip(orderSummary) {
    const chip = document.createElement('button');
    const tooltipText = orderSummary.tooltipLines.join('\n');
    chip.className = `jobOrderChip jobOrderChip--${orderSummary.status}`;
    chip.type = 'button';
    chip.setAttribute('aria-label', `${orderSummary.pendingCount} to order, ${orderSummary.orderedCount} ordered, ${orderSummary.arrivedCount} arrived`);
    chip.dataset.tooltip = tooltipText;

    const count = document.createElement('span');
    count.className = 'jobOrderChipCount';
    count.textContent = orderSummary.status === 'arrived'
        ? '✓'
        : `${orderSummary.pendingCount}/${orderSummary.orderedCount}/${orderSummary.arrivedCount}`;
    chip.appendChild(count);

    chip.addEventListener('click', function(event) {
        event.stopPropagation();
    });
    chip.addEventListener('mouseenter', handleOrderChipTooltipShow);
    chip.addEventListener('mouseleave', hideOrderChipTooltip);
    chip.addEventListener('focus', handleOrderChipTooltipShow);
    chip.addEventListener('blur', hideOrderChipTooltip);

    return chip;
}

function handleOrderChipTooltipShow(event) {
    const chip = event.currentTarget;
    showOrderChipTooltip(chip, chip.dataset.tooltip || '');
}

function showOrderChipTooltip(chip, text) {
    hideOrderChipTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'jobOrderChipTooltipLayer';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = text;
    document.body.appendChild(tooltip);
    activeOrderChipTooltip = tooltip;
    activeOrderChipAnchor = chip;

    window.addEventListener('scroll', hideOrderChipTooltip, true);
    window.addEventListener('resize', hideOrderChipTooltip);

    positionOrderChipTooltip(chip, tooltip);
}

function positionOrderChipTooltip(chip, tooltip) {
    if (!chip || !tooltip) {
        return;
    }

    const chipRect = chip.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const top = Math.max(8, chipRect.top - tooltipRect.height - 8);
    const left = Math.min(
        window.innerWidth - tooltipRect.width - 8,
        Math.max(8, chipRect.right - tooltipRect.width)
    );

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}

function hideOrderChipTooltip() {
    if (activeOrderChipTooltip) {
        activeOrderChipTooltip.remove();
        activeOrderChipTooltip = null;
    }
    if (activeOrderChipAnchor) {
        activeOrderChipAnchor = null;
        window.removeEventListener('scroll', hideOrderChipTooltip, true);
        window.removeEventListener('resize', hideOrderChipTooltip);
    }
}

function setupJobColumnDropzone(column) {
    column.addEventListener('dragover', function(event) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
        this.classList.add('drag-over');
    });

    column.addEventListener('dragleave', function(event) {
        if (!this.contains(event.relatedTarget)) {
            this.classList.remove('drag-over');
        }
    });

    column.addEventListener('drop', function(event) {
        event.preventDefault();
        this.classList.remove('drag-over');

        let jobNumber = '';
        if (event.dataTransfer) {
            jobNumber = event.dataTransfer.getData('text/plain');
        }

        if (!jobNumber) {
            jobNumber = draggedJobNumber;
        }

        if (!jobNumber) {
            return;
        }

        moveJobToState(jobNumber, this.id);
    });
}

function clearColumnDragState() {
    jobStates.forEach(state => {
        const column = document.getElementById(state);
        if (column) {
            column.classList.remove('drag-over');
        }
    });
}

function moveJobToState(jobNumber, nextState) {
    const jobIndex = allJobs.findIndex(job => job.jobNumber.toString() === jobNumber.toString());
    if (jobIndex === -1) {
        return;
    }

    const previousState = allJobs[jobIndex].jobState;
    if (previousState === nextState) {
        return;
    }

    allJobs[jobIndex] = {
        ...allJobs[jobIndex],
        jobState: nextState
    };
    displayJobs(allJobs);

    fetch(`/jobs/${jobNumber}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobState: nextState })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`State update failed with status ${response.status}`);
        }
        return response.json();
    })
    .then(payload => {
        if (payload.job) {
            allJobs[jobIndex] = payload.job;
            displayJobs(allJobs);
        } else {
            fetchJobs();
        }
    })
    .catch(error => {
        console.error('Error updating job state:', error);
        allJobs[jobIndex] = {
            ...allJobs[jobIndex],
            jobState: previousState
        };
        displayJobs(allJobs);
        alert('Failed to move job. Please try again.');
    });
}

function isTouchLikeDevice() {
    return window.matchMedia('(pointer: coarse)').matches;
}

function handleCardLongPressStart(event, jobNumber) {
    if (!isTouchLikeDevice()) {
        return;
    }

    clearLongPressTimer();
    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        suppressCardClick = true;
        openStatePickerOverlay(jobNumber);
    }, longPressDurationMs);
}

function handleCardLongPressEnd() {
    if (!isTouchLikeDevice()) {
        return;
    }

    if (!longPressTriggered) {
        clearLongPressTimer();
    }
}

function clearLongPressTimer() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

function setupStatePickerOverlay() {
    const overlay = document.getElementById('statePickerOverlay');
    const closeButton = document.getElementById('closeStatePickerOverlay');

    if (!overlay || !closeButton) {
        return;
    }

    closeButton.addEventListener('click', closeStatePickerOverlay);
    overlay.addEventListener('click', function(event) {
        if (event.target === overlay) {
            closeStatePickerOverlay();
        }
    });
}

function openStatePickerOverlay(jobNumber) {
    const overlay = document.getElementById('statePickerOverlay');
    const title = document.getElementById('statePickerTitle');
    const subtitle = document.getElementById('statePickerSubtitle');
    const options = document.getElementById('statePickerOptions');

    if (!overlay || !title || !subtitle || !options) {
        return;
    }

    const job = allJobs.find(j => j.jobNumber.toString() === jobNumber.toString());
    if (!job) {
        return;
    }

    title.textContent = `Move Job #${job.jobNumber}`;
    subtitle.textContent = `${job.customerDetails.name} (Current: ${job.jobState})`;
    options.innerHTML = '';

    jobStates.forEach(state => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'statePickerOption';
        button.textContent = state;
        if (state === job.jobState) {
            button.classList.add('current-state');
            button.disabled = true;
        }
        button.addEventListener('click', () => {
            closeStatePickerOverlay();
            moveJobToState(jobNumber, state);
        });
        options.appendChild(button);
    });

    overlay.classList.add('open');
    clearLongPressTimer();
}

function closeStatePickerOverlay() {
    const overlay = document.getElementById('statePickerOverlay');
    if (overlay) {
        overlay.classList.remove('open');
    }
    longPressTriggered = false;
    clearLongPressTimer();
}

function displayOrderItems(jobs) {
    const list = document.getElementById('orderItemsList');
    const emptyState = document.getElementById('orderItemsEmptyState');
    const sortKey = document.getElementById('sortSelect').value;
    const selectedSupplier = document.getElementById('supplierFilter').value;
    const includeDelivered = document.getElementById('includeDeliveredToggle').checked;
    list.innerHTML = '';
    let rowCount = 0;

    jobs.forEach((job) => {
        const jobItems = Array.isArray(job.orderItems) ? job.orderItems : [];
        jobItems
            .filter(item => {
                const matchesOrderStatus = orderStatusFilter === 'ordered' ? Boolean(item.ordered) : !item.ordered;
                const matchesSupplier = !selectedSupplier || item.supplier === selectedSupplier;
                const matchesDelivered = includeDelivered ? true : !item.delivered;
                return matchesOrderStatus && matchesSupplier && matchesDelivered;
            })
            .sort((a, b) => {
                return String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''));
            })
            .forEach(item => {
                const row = document.createElement('tr');

                const jobCell = document.createElement('td');
                const customerName = job.customerDetails && job.customerDetails.name ? job.customerDetails.name : '';
                const jobNumberStrong = document.createElement('strong');
                jobNumberStrong.textContent = `#${job.jobNumber || ''}`;
                const jobNameDiv = document.createElement('div');
                jobNameDiv.className = 'order-job-name';
                jobNameDiv.textContent = customerName;
                jobCell.appendChild(jobNumberStrong);
                jobCell.appendChild(jobNameDiv);

                const itemTypeCell = document.createElement('td');
                itemTypeCell.textContent = item.itemType;

                const supplierCell = document.createElement('td');
                supplierCell.textContent = item.supplier;

                const itemCell = document.createElement('td');
                itemCell.textContent = item.item;

                const orderedCell = document.createElement('td');
                const orderedCheckbox = document.createElement('input');
                orderedCheckbox.type = 'checkbox';
                orderedCheckbox.checked = item.ordered;
                orderedCheckbox.addEventListener('change', () => {
                    item.ordered = orderedCheckbox.checked;
                    item.orderDate = orderedCheckbox.checked ? formatDate(new Date()) : '';
                    updateJob(job.jobNumber, job);
                    displayOrderItems(allJobs);
                });
                orderedCell.appendChild(orderedCheckbox);

                const orderDateCell = document.createElement('td');
                orderDateCell.textContent = item.orderDate;

                const deliveredCell = document.createElement('td');
                const deliveredCheckbox = document.createElement('input');
                deliveredCheckbox.type = 'checkbox';
                deliveredCheckbox.checked = item.delivered;
                deliveredCheckbox.addEventListener('change', () => {
                    item.delivered = deliveredCheckbox.checked;
                    item.deliveryDate = deliveredCheckbox.checked ? formatDate(new Date()) : '';
                    updateJob(job.jobNumber, job);
                    displayOrderItems(allJobs);
                });
                deliveredCell.appendChild(deliveredCheckbox);

                const deliveryDateCell = document.createElement('td');
                deliveryDateCell.textContent = item.deliveryDate;

                row.appendChild(jobCell);
                row.appendChild(itemTypeCell);
                row.appendChild(supplierCell);
                row.appendChild(itemCell);
                row.appendChild(orderedCell);
                row.appendChild(orderDateCell);
                row.appendChild(deliveredCell);
                row.appendChild(deliveryDateCell);

                list.appendChild(row);
                rowCount += 1;
            });
    });

    if (emptyState) {
        emptyState.hidden = rowCount !== 0;
    }
}




function sortTable(sortKey) {
    document.getElementById('sortSelect').value = sortKey; // Sync dropdown with column sort
    displayOrderItems(allJobs);
}

function updateJob(jobNumber, updatedJob) {
    const jobIndex = allJobs.findIndex(job => job.jobNumber.toString() === jobNumber.toString());
    if (jobIndex !== -1) {
        allJobs[jobIndex] = updatedJob; // Update client-side job data
    }
    //saveJobDetails(jobNumber, updatedJob); // Send updated data to the server
    fetch(`/jobs/${jobNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedJob)
    })
    .then(response => response.json())
    .then(data => {
        console.log('Job details (ordered and delivered) saved successfully!');
        // Refetch job details to update the view
    })
    .then(() => {
       // console.log('Job data reloaded successfully.');
    })
    .catch(error => {
        console.error('Error saving job details:', error);
        alert('Failed to save job details.');
    });
}

function populateSupplierDropdown(jobs) {
    const supplierSet = new Set();
    jobs.forEach(job => {
        const jobItems = Array.isArray(job.orderItems) ? job.orderItems : [];
        jobItems.forEach(item => {
            supplierSet.add(item.supplier);
        });
    });
    const supplierDropdown = document.getElementById('supplierFilter');
    supplierDropdown.innerHTML = '<option value="">All Suppliers</option>'; // Option to show all
    supplierSet.forEach(supplier => {
        const option = document.createElement('option');
        option.value = supplier;
        option.textContent = supplier;
        supplierDropdown.appendChild(option);
    });
}

document.getElementById('supplierFilter').addEventListener('change', function() {
    displayOrderItems(allJobs);
});


function formatDate(date) {
    let day = ('0' + date.getDate()).slice(-2);
    let month = ('0' + (date.getMonth() + 1)).slice(-2);
    let year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function setupCalendarModal() {
    const modal = document.getElementById('calendarModal');
    const monthTriggerButton = document.getElementById('calendarMonthPickerButton');
    const monthTriggerLabel = document.getElementById('calendarMonthTriggerLabel');
    const monthSelect = document.getElementById('calendarMonthSelect');
    const yearSelect = document.getElementById('calendarYearSelect');
    const todayButton = document.getElementById('calendarTodayButton');
    const pickerApplyButton = document.getElementById('calendarPickerApplyButton');
    const prevDayButton = document.getElementById('calendarPrevDayButton');
    const nextDayButton = document.getElementById('calendarNextDayButton');
    const closeDayPanelButton = document.getElementById('calendarCloseDayPanelButton');
    const addEntryButton = document.getElementById('calendarAddEntryButton');

    if (!modal || !monthTriggerButton || !monthTriggerLabel || !monthSelect || !yearSelect || !todayButton || !pickerApplyButton || !prevDayButton || !nextDayButton || !closeDayPanelButton || !addEntryButton) {
        return;
    }

    populateCalendarSelectors();

    monthTriggerButton.addEventListener('click', function() {
        syncCalendarSelectors();
        $('#calendarMonthPickerModal').modal('show');
    });

    pickerApplyButton.addEventListener('click', function() {
        calendarState.viewMonth = Number(monthSelect.value);
        calendarState.viewYear = Number(yearSelect.value);
        calendarState.selectedDate = getLocalDateKey(new Date(calendarState.viewYear, calendarState.viewMonth, 1));
        $('#calendarMonthPickerModal').modal('hide');
        loadCalendarMonth(calendarState.viewYear, calendarState.viewMonth);
    });

    todayButton.addEventListener('click', function() {
        const today = new Date();
        calendarState.viewYear = today.getFullYear();
        calendarState.viewMonth = today.getMonth();
        calendarState.selectedDate = getLocalDateKey(today);
        calendarState.mobileDayPanelOpen = false;
        syncCalendarSelectors();
        loadCalendarMonth(calendarState.viewYear, calendarState.viewMonth);
    });

    prevDayButton.addEventListener('click', function() {
        shiftCalendarSelectedDay(-1);
    });

    nextDayButton.addEventListener('click', function() {
        shiftCalendarSelectedDay(1);
    });

    closeDayPanelButton.addEventListener('click', function() {
        closeCalendarDayPanel();
    });

    addEntryButton.addEventListener('click', function() {
        if (!calendarState.selectedDate) {
            calendarState.selectedDate = getLocalDateKey(new Date(calendarState.viewYear, calendarState.viewMonth, 1));
        }
        addCalendarEntryDraft();
    });

    $('#calendarModal').on('show.bs.modal', function () {
        syncCalendarSelectors();
        calendarState.mobileDayPanelOpen = false;
        if (!calendarState.selectedDate || !calendarState.selectedDate.startsWith(createCalendarMonthKey(calendarState.viewYear, calendarState.viewMonth))) {
            const today = new Date();
            calendarState.selectedDate = today.getFullYear() === calendarState.viewYear && today.getMonth() === calendarState.viewMonth
                ? getLocalDateKey(today)
                : getLocalDateKey(new Date(calendarState.viewYear, calendarState.viewMonth, 1));
        }
        loadCalendarMonth(calendarState.viewYear, calendarState.viewMonth);
    });

    renderCalendar();
}

function populateCalendarSelectors() {
    const monthSelect = document.getElementById('calendarMonthSelect');
    const yearSelect = document.getElementById('calendarYearSelect');
    if (!monthSelect || !yearSelect) {
        return;
    }

    monthSelect.innerHTML = '';
    calendarMonthNames.forEach(function(name, index) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = name;
        monthSelect.appendChild(option);
    });

    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let year = currentYear - 5; year <= currentYear + 7; year += 1) {
        const option = document.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        yearSelect.appendChild(option);
    }

    syncCalendarSelectors();
}

function syncCalendarSelectors() {
    const monthTriggerLabel = document.getElementById('calendarMonthTriggerLabel');
    const monthSelect = document.getElementById('calendarMonthSelect');
    const yearSelect = document.getElementById('calendarYearSelect');
    const todayButton = document.getElementById('calendarTodayButton');

    if (monthSelect) {
        monthSelect.value = String(calendarState.viewMonth);
    }

    if (yearSelect) {
        const targetYear = String(calendarState.viewYear);
        const hasOption = Array.from(yearSelect.options).some(option => option.value === targetYear);
        if (!hasOption) {
            const option = document.createElement('option');
            option.value = targetYear;
            option.textContent = targetYear;
            yearSelect.appendChild(option);
        }
        yearSelect.value = targetYear;
    }

    if (monthTriggerLabel) {
        monthTriggerLabel.textContent = `${calendarMonthNames[calendarState.viewMonth]} ${calendarState.viewYear}`;
    }

    if (todayButton) {
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === calendarState.viewYear && today.getMonth() === calendarState.viewMonth;
        todayButton.hidden = isCurrentMonth;
        todayButton.title = isCurrentMonth ? '' : 'Jump to current month';
    }
}

function createCalendarMonthKey(year, monthIndex) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function getLocalDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateKey(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
    if (!match) {
        return null;
    }
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function loadCalendarMonth(year, monthIndex) {
    const monthKey = createCalendarMonthKey(year, monthIndex);
    calendarState.loading = true;
    setCalendarStatus(`Loading ${calendarMonthNames[monthIndex]} ${year}...`);
    renderCalendar();

    fetch(`/calendar?month=${encodeURIComponent(monthKey)}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load calendar (${response.status})`);
            }
            return response.json();
        })
        .then(payload => {
            calendarState.days = payload.days || {};
            calendarState.updatedAt = payload.updatedAt || '';
            calendarState.loading = false;
            if (!calendarState.selectedDate || !calendarState.selectedDate.startsWith(`${monthKey}-`)) {
                calendarState.selectedDate = getLocalDateKey(new Date(year, monthIndex, 1));
            }
            setCalendarStatus(calendarState.updatedAt ? `Saved ${formatCalendarTimestamp(calendarState.updatedAt)}` : 'Monthly planner');
            renderCalendar();
        })
        .catch(error => {
            console.error('Error loading calendar:', error);
            calendarState.loading = false;
            setCalendarStatus('Failed to load calendar');
            renderCalendar();
        });
}

function setCalendarStatus(message) {
    const status = document.getElementById('calendarStatusText');
    if (status) {
        status.textContent = message;
    }
}

function formatCalendarTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'recently';
    }
    return date.toLocaleString([], {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getCalendarGridStart(year, monthIndex) {
    const firstOfMonth = new Date(year, monthIndex, 1);
    const start = new Date(firstOfMonth);
    const day = firstOfMonth.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    start.setDate(firstOfMonth.getDate() - mondayOffset);
    return start;
}

function renderCalendar() {
    renderCalendarGrid();
    renderCalendarDayPanel();
    syncCalendarSelectors();
}

function renderCalendarGrid() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) {
        return;
    }

    grid.innerHTML = '';
    const todayKey = getLocalDateKey(new Date());
    const gridStart = getCalendarGridStart(calendarState.viewYear, calendarState.viewMonth);

    for (let offset = 0; offset < 42; offset += 1) {
        const date = new Date(gridStart);
        date.setDate(gridStart.getDate() + offset);
        const dateKey = getLocalDateKey(date);
        const entries = Array.isArray(calendarState.days[dateKey]) ? calendarState.days[dateKey] : [];
        const isCurrentMonth = date.getMonth() === calendarState.viewMonth && date.getFullYear() === calendarState.viewYear;

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'calendar-day-cell';
        if (!isCurrentMonth) {
            cell.classList.add('is-outside-month');
        }
        if (dateKey === todayKey) {
            cell.classList.add('is-today');
        }
        if (dateKey === calendarState.selectedDate) {
            cell.classList.add('is-selected');
        }

        const header = document.createElement('div');
        header.className = 'calendar-day-cell-header';

        const number = document.createElement('div');
        number.className = 'calendar-day-number';
        number.textContent = String(date.getDate());

        const count = document.createElement('div');
        count.className = 'calendar-entry-count';
        count.textContent = entries.length ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : '';

        const items = document.createElement('div');
        items.className = 'calendar-day-items';
        entries.slice(0, 6).forEach(function(entry) {
            const pill = document.createElement('div');
            pill.className = 'calendar-entry-pill';
            if (entry.jobNumber) {
                pill.classList.add('has-job-link');
            }
            pill.textContent = formatCalendarEntrySummary(entry);
            items.appendChild(pill);
        });

        if (entries.length > 6) {
            const more = document.createElement('div');
            more.className = 'calendar-entry-more';
            more.textContent = `+${entries.length - 6} more`;
            items.appendChild(more);
        }

        header.appendChild(number);
        header.appendChild(count);
        cell.appendChild(header);
        cell.appendChild(items);
        cell.addEventListener('click', function() {
            if (!isCurrentMonth) {
                calendarState.viewYear = date.getFullYear();
                calendarState.viewMonth = date.getMonth();
                calendarState.selectedDate = dateKey;
                if (isMobileCalendarLayout()) {
                    calendarState.mobileDayPanelOpen = true;
                }
                syncCalendarSelectors();
                loadCalendarMonth(calendarState.viewYear, calendarState.viewMonth);
                return;
            }
            calendarState.selectedDate = dateKey;
            if (isMobileCalendarLayout()) {
                calendarState.mobileDayPanelOpen = true;
            }
            renderCalendar();
        });

        grid.appendChild(cell);
    }
}

function formatCalendarEntrySummary(entry) {
    const prefix = entry.time ? `${entry.time} ` : '';
    const jobSuffix = entry.jobNumber ? ` · #${entry.jobNumber}` : '';
    return `${prefix}${entry.text || ''}${jobSuffix}`.trim();
}

function renderCalendarDayPanel() {
    const title = document.getElementById('calendarDayPanelTitle');
    const subtitle = document.getElementById('calendarDayPanelSubtitle');
    const entriesContainer = document.getElementById('calendarDayEntries');
    const addEntryButton = document.getElementById('calendarAddEntryButton');
    const panel = document.querySelector('.calendar-day-panel');

    if (!title || !subtitle || !entriesContainer || !addEntryButton || !panel) {
        return;
    }

    panel.classList.toggle('is-mobile-open', isMobileCalendarLayout() && calendarState.mobileDayPanelOpen);

    entriesContainer.innerHTML = '';

    if (!calendarState.selectedDate) {
        title.textContent = 'Select a day';
        subtitle.textContent = 'Add or edit entries for the selected date.';
        addEntryButton.disabled = true;
        entriesContainer.appendChild(createCalendarEmptyState('Choose a date from the month grid to start planning.'));
        return;
    }

    addEntryButton.disabled = false;
    title.textContent = formatCalendarPanelDate(calendarState.selectedDate);
    subtitle.textContent = 'Keep each line simple, or expand it with time, notes and a linked job.';

    const entries = getCalendarEntriesForDate(calendarState.selectedDate);
    if (!entries.length) {
        calendarState.expandedEntryId = '';
        entriesContainer.appendChild(createCalendarEmptyState('No entries for this day yet. Add one from the button above.'));
        return;
    }

    if (!entries.some(entry => entry.id === calendarState.expandedEntryId)) {
        calendarState.expandedEntryId = entries[0].id;
    }

    entries.forEach(function(entry, index) {
        entriesContainer.appendChild(createCalendarEntryEditor(entry, index));
    });
}

function createCalendarEmptyState(message) {
    const empty = document.createElement('div');
    empty.className = 'calendar-empty-state';
    empty.textContent = message;
    return empty;
}

function getCalendarEntriesForDate(dateKey) {
    if (!Array.isArray(calendarState.days[dateKey])) {
        calendarState.days[dateKey] = [];
    }
    return calendarState.days[dateKey];
}

function createCalendarEntryEditor(entry, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'calendar-entry-editor';
    if (entry._dirty || entry.isDraft) {
        wrapper.classList.add('is-dirty');
    }
    if (entry.id === calendarState.expandedEntryId || entry.isDraft) {
        wrapper.classList.add('is-open');
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'calendar-entry-editor-toggle';
    toggle.addEventListener('click', function() {
        toggleCalendarEntryDrawer(entry.id);
    });

    const header = document.createElement('div');
    header.className = 'calendar-entry-editor-header';

    const summary = document.createElement('div');
    summary.className = 'calendar-entry-editor-summary';
    summary.textContent = formatCalendarDrawerSummary(entry);

    const meta = document.createElement('div');
    meta.className = 'calendar-entry-editor-meta';
    buildCalendarDrawerMeta(entry).forEach(function(text) {
        const item = document.createElement('span');
        item.textContent = text;
        meta.appendChild(item);
    });

    const chevron = document.createElement('span');
    chevron.className = 'calendar-entry-chevron glyphicon glyphicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');

    header.appendChild(summary);
    if (meta.childNodes.length) {
        header.appendChild(meta);
    }
    toggle.appendChild(header);
    toggle.appendChild(chevron);
    wrapper.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'calendar-entry-editor-body';

    const actions = document.createElement('div');
    actions.className = 'calendar-entry-actions';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-primary btn-xs';
    saveButton.textContent = calendarState.savingDate === calendarState.selectedDate ? 'Saving...' : 'Save';
    saveButton.disabled = calendarState.savingDate === calendarState.selectedDate;
    saveButton.addEventListener('click', function() {
        saveCalendarEntry(index);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-default btn-xs';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', function() {
        deleteCalendarEntry(index);
    });

    actions.appendChild(deleteButton);
    actions.appendChild(saveButton);
    body.appendChild(actions);

    const form = document.createElement('div');
    form.className = 'calendar-entry-form';

    form.appendChild(createCalendarInputField('Line text', 'text', entry.text || '', function(value, source) {
        updateCalendarEntryField(index, 'text', value, source);
    }, { placeholder: 'What needs doing?' }));

    const row = document.createElement('div');
    row.className = 'calendar-entry-row';
    row.appendChild(createCalendarInputField('Start time', 'time', entry.time || '', function(value, source) {
        updateCalendarEntryField(index, 'time', value, source);
    }));
    row.appendChild(createCalendarInputField('End time', 'time', entry.endTime || '', function(value, source) {
        updateCalendarEntryField(index, 'endTime', value, source);
    }));
    form.appendChild(row);

    form.appendChild(createCalendarTextAreaField('Extra info', entry.details || '', function(value, source) {
        updateCalendarEntryField(index, 'details', value, source);
    }));

    const selectField = createCalendarJobSelectField(entry.jobNumber || '', function(value, source) {
        updateCalendarEntryField(index, 'jobNumber', value, source);
    });
    form.appendChild(selectField);

    if (entry.jobNumber) {
        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'btn btn-default btn-xs calendar-entry-open-job';
        openButton.textContent = `Open Job #${entry.jobNumber}`;
        openButton.addEventListener('click', function() {
            $('#calendarModal').modal('hide');
            showJobDetails(entry.jobNumber);
        });
        form.appendChild(openButton);
    }

    body.appendChild(form);
    wrapper.appendChild(body);
    return wrapper;
}

function buildCalendarDrawerMeta(entry) {
    const meta = [];
    if (entry.time || entry.endTime) {
        meta.push(entry.endTime ? `${entry.time || '--:--'}-${entry.endTime}` : entry.time);
    }
    if (entry.jobNumber) {
        meta.push(`#${entry.jobNumber}`);
    }
    if (entry._dirty || entry.isDraft) {
        meta.push('Unsaved');
    }
    return meta;
}

function formatCalendarDrawerSummary(entry) {
    if (String(entry.text || '').trim()) {
        return String(entry.text).trim();
    }
    return entry.isDraft ? 'New entry' : 'Untitled entry';
}

function createCalendarInputField(labelText, type, value, onChange, options) {
    const wrapper = document.createElement('label');
    wrapper.textContent = labelText;

    const input = document.createElement('input');
    input.type = type;
    input.className = 'form-control input-sm';
    input.value = value;
    if (options && options.placeholder) {
        input.placeholder = options.placeholder;
    }
    input.addEventListener('input', function() {
        onChange(this.value, this);
    });

    wrapper.appendChild(input);
    return wrapper;
}

function createCalendarTextAreaField(labelText, value, onChange) {
    const wrapper = document.createElement('label');
    wrapper.textContent = labelText;

    const textarea = document.createElement('textarea');
    textarea.className = 'form-control input-sm';
    textarea.value = value;
    textarea.addEventListener('input', function() {
        onChange(this.value, this);
    });

    wrapper.appendChild(textarea);
    return wrapper;
}

function createCalendarJobSelectField(value, onChange) {
    const wrapper = document.createElement('label');
    wrapper.textContent = 'Linked job';

    const select = document.createElement('select');
    select.className = 'form-control input-sm';

    const blankOption = document.createElement('option');
    blankOption.value = '';
    blankOption.textContent = 'No linked job';
    select.appendChild(blankOption);

    allJobs
        .slice()
        .sort((left, right) => String(left.jobNumber).localeCompare(String(right.jobNumber)))
        .forEach(function(job) {
            const option = document.createElement('option');
            option.value = String(job.jobNumber);
            option.textContent = `#${job.jobNumber} · ${(job.customerDetails && job.customerDetails.name) || 'Untitled job'}`;
            select.appendChild(option);
        });

    select.value = value || '';
    select.addEventListener('change', function() {
        onChange(this.value, this);
    });

    wrapper.appendChild(select);
    return wrapper;
}

function updateCalendarEntryField(index, field, value, sourceElement) {
    const entries = getCalendarEntriesForDate(calendarState.selectedDate);
    if (!entries[index]) {
        return;
    }
    entries[index][field] = value;
    entries[index]._dirty = true;
    if (sourceElement) {
        const editor = sourceElement.closest('.calendar-entry-editor');
        if (editor) {
            editor.classList.add('is-dirty');
        }
    }
}

function addCalendarEntryDraft() {
    const entries = getCalendarEntriesForDate(calendarState.selectedDate);
    const existingBlankDraft = entries.find(entry => entry.isDraft && !String(entry.text || '').trim());
    if (existingBlankDraft) {
        renderCalendarDayPanel();
        return;
    }

    entries.push({
        id: `draft-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        text: '',
        time: '',
        endTime: '',
        details: '',
        jobNumber: '',
        isDraft: true,
        _dirty: true,
        createdAt: new Date().toISOString()
    });
    calendarState.expandedEntryId = entries[entries.length - 1].id;
    if (isMobileCalendarLayout()) {
        calendarState.mobileDayPanelOpen = true;
    }
    renderCalendarDayPanel();
}

function toggleCalendarEntryDrawer(entryId) {
    calendarState.expandedEntryId = calendarState.expandedEntryId === entryId ? '' : entryId;
    renderCalendarDayPanel();
}

function saveCalendarEntry(index) {
    const entry = getCalendarEntriesForDate(calendarState.selectedDate)[index];
    if (!entry) {
        return;
    }

    if (!String(entry.text || '').trim()) {
        alert('Calendar entry text is required.');
        return;
    }

    persistCalendarDay();
}

function deleteCalendarEntry(index) {
    const entries = getCalendarEntriesForDate(calendarState.selectedDate);
    entries.splice(index, 1);
    persistCalendarDay();
}

function buildCalendarDayPayload(dateKey) {
    const entries = getCalendarEntriesForDate(dateKey);
    const payloadEntries = [];

    for (const entry of entries) {
        const text = String(entry.text || '').trim();
        const details = String(entry.details || '').trim();
        const time = String(entry.time || '').trim();
        const endTime = String(entry.endTime || '').trim();
        const jobNumber = String(entry.jobNumber || '').trim();
        const hasAnyContent = Boolean(text || details || time || endTime || jobNumber);

        if (!text) {
            if (entry.isDraft && !hasAnyContent) {
                continue;
            }
            throw new Error('Each calendar entry needs text before it can be saved.');
        }

        payloadEntries.push({
            id: entry.id,
            text,
            time,
            endTime,
            details,
            jobNumber,
            status: entry.status || 'active',
            createdAt: entry.createdAt || new Date().toISOString()
        });
    }

    return payloadEntries;
}

function persistCalendarDay() {
    if (!calendarState.selectedDate) {
        return Promise.resolve();
    }

    let entries;
    try {
        entries = buildCalendarDayPayload(calendarState.selectedDate);
    } catch (error) {
        alert(error.message);
        return Promise.reject(error);
    }

    calendarState.savingDate = calendarState.selectedDate;
    setCalendarStatus(`Saving ${formatCalendarPanelDate(calendarState.selectedDate)}...`);
    renderCalendarDayPanel();

    return fetch(`/calendar/day/${encodeURIComponent(calendarState.selectedDate)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries })
    })
        .then(response => {
            if (!response.ok) {
                return response.json().catch(() => ({})).then(payload => {
                    throw new Error(payload.message || `Failed to save calendar (${response.status})`);
                });
            }
            return response.json();
        })
        .then(payload => {
            calendarState.days[calendarState.selectedDate] = payload.entries || [];
            if (!calendarState.days[calendarState.selectedDate].length) {
                delete calendarState.days[calendarState.selectedDate];
                calendarState.expandedEntryId = '';
            } else if (!calendarState.days[calendarState.selectedDate].some(entry => entry.id === calendarState.expandedEntryId)) {
                calendarState.expandedEntryId = calendarState.days[calendarState.selectedDate][0].id;
            }
            calendarState.updatedAt = payload.updatedAt || '';
            calendarState.savingDate = '';
            setCalendarStatus(calendarState.updatedAt ? `Saved ${formatCalendarTimestamp(calendarState.updatedAt)}` : 'Monthly planner');
            renderCalendar();
        })
        .catch(error => {
            console.error('Error saving calendar day:', error);
            calendarState.savingDate = '';
            setCalendarStatus('Failed to save calendar');
            renderCalendarDayPanel();
            alert(error.message || 'Failed to save calendar day.');
        });
}

function formatCalendarPanelDate(dateKey) {
    const date = parseDateKey(dateKey);
    if (!date) {
        return dateKey;
    }
    return date.toLocaleDateString([], {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function isMobileCalendarLayout() {
    return window.matchMedia('(max-width: 991px)').matches;
}

function closeCalendarDayPanel() {
    calendarState.mobileDayPanelOpen = false;
    renderCalendarDayPanel();
}

function shiftCalendarSelectedDay(offsetDays) {
    if (!calendarState.selectedDate) {
        return;
    }

    const currentDate = parseDateKey(calendarState.selectedDate);
    if (!currentDate) {
        return;
    }

    const nextDate = new Date(currentDate);
    nextDate.setDate(currentDate.getDate() + offsetDays);
    const nextDateKey = getLocalDateKey(nextDate);
    const nextYear = nextDate.getFullYear();
    const nextMonth = nextDate.getMonth();
    const monthChanged = nextYear !== calendarState.viewYear || nextMonth !== calendarState.viewMonth;

    calendarState.selectedDate = nextDateKey;
    calendarState.mobileDayPanelOpen = true;

    if (monthChanged) {
        calendarState.viewYear = nextYear;
        calendarState.viewMonth = nextMonth;
        syncCalendarSelectors();
        loadCalendarMonth(nextYear, nextMonth);
        return;
    }

    renderCalendar();
}


function getColorForLastUpdate(lastUpdate) {
    const today = new Date();
    const diffTime = Math.abs(today - lastUpdate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    //console.log("diffdays:" + lastUpdate + " " + diffDays)
;    return `hsl(${Math.max(0, 120 - 4 * diffDays)}, 35%, 60%)`; // Gradually change from green to red
}

function toggleColumnWidth(column) {
    // Toggle a class that controls the width
    column.classList.toggle('expanded');
}


function setupStatsDashboard() {
    const rangeSelect = document.getElementById('statsRangeSelect');
    if (rangeSelect) {
        rangeSelect.addEventListener('change', loadStatsDashboard);
    }

    $('#statsModal').on('show.bs.modal', function () {
        loadStatsDashboard();
    });
}

function loadStatsDashboard() {
    const rangeSelect = document.getElementById('statsRangeSelect');
    const range = rangeSelect ? rangeSelect.value : 'all';

    fetch(`/stats?range=${encodeURIComponent(range)}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load stats (${response.status})`);
            }
            return response.json();
        })
        .then(stats => {
            renderPipelineStats(stats);
            renderFlowStats(stats);
            renderSupplyStats(stats);
        })
        .catch(error => {
            console.error('Error loading stats:', error);
            renderStatsError('Failed to load stats. Please try again.');
        });
}

function renderStatsError(message) {
    const pipeline = document.getElementById('statsPipelineSummary');
    const flow = document.getElementById('statsFlowSummary');
    const supply = document.getElementById('statsSupplySummary');
    if (pipeline) pipeline.innerHTML = `<p class="text-danger">${message}</p>`;
    if (flow) flow.innerHTML = `<p class="text-danger">${message}</p>`;
    if (supply) supply.innerHTML = `<p class="text-danger">${message}</p>`;

    destroyStatsCharts();
}

function destroyStatsCharts() {
    if (statsPipelineChart) {
        statsPipelineChart.destroy();
        statsPipelineChart = null;
    }
    if (statsFlowChart) {
        statsFlowChart.destroy();
        statsFlowChart = null;
    }
    if (statsSupplyChart) {
        statsSupplyChart.destroy();
        statsSupplyChart = null;
    }
}

function formatCurrency(value) {
    return `£${Number(value || 0).toFixed(2)}`;
}

function renderPipelineStats(stats) {
    const target = document.getElementById('statsPipelineSummary');
    if (!target || !stats || !stats.pipeline) {
        return;
    }

    const stateCounts = stats.pipeline.stateCounts || {};
    const stateCosts = stats.pipeline.stateCosts || {};
    const rows = Object.keys(stateCounts).map(state => {
        return `<tr><td>${state}</td><td>${stateCounts[state]}</td><td>${formatCurrency(stateCosts[state])}</td></tr>`;
    }).join('');

    target.innerHTML = `
        <p><strong>Range:</strong> ${stats.range} | <strong>Jobs in scope:</strong> ${stats.jobCount} | <strong>Active jobs:</strong> ${stats.pipeline.totalActiveJobs}</p>
        <table class="table table-condensed">
            <thead><tr><th>State</th><th>Jobs</th><th>Total Cost</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">No data in selected range.</td></tr>'}</tbody>
        </table>
        <p><strong>Ongoing:</strong> ${stats.pipeline.ongoing.jobCount} jobs | ${formatCurrency(stats.pipeline.ongoing.totalCost)}</p>
    `;

    const chartCanvas = document.getElementById('statsPipelineChart');
    if (!chartCanvas) {
        return;
    }

    if (statsPipelineChart) {
        statsPipelineChart.destroy();
    }

    const labels = Object.keys(stateCounts);
    const values = labels.map(label => stateCounts[label]);

    statsPipelineChart = new Chart(chartCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                label: 'Jobs by State',
                data: values
            }]
        },
        options: {
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function renderFlowStats(stats) {
    const target = document.getElementById('statsFlowSummary');
    if (!target || !stats || !stats.flow || !stats.timeline) {
        return;
    }

    const avgTaskDurations = stats.flow.averageTaskDurations || {};
    const sortedTasks = Object.keys(avgTaskDurations)
        .map(task => ({ task, days: avgTaskDurations[task] }))
        .sort((a, b) => b.days - a.days)
        .slice(0, 10);

    const timelineRows = Object.keys(stats.timeline.byMonth || {}).map(month => {
        return `<tr><td>${month}</td><td>${stats.timeline.byMonth[month].count}</td></tr>`;
    }).join('');

    target.innerHTML = `
        <p><strong>Avg Going Ahead -> Completed:</strong> ${Number(stats.flow.averageJobDurationDays || 0).toFixed(2)} days</p>
        <p><strong>Completed jobs measured:</strong> ${stats.flow.completedJobsMeasured || 0}</p>
        <table class="table table-condensed">
            <thead><tr><th>Month</th><th>Timeline Actions</th></tr></thead>
            <tbody>${timelineRows || '<tr><td colspan="2">No timeline activity in selected range.</td></tr>'}</tbody>
        </table>
    `;

    const chartCanvas = document.getElementById('statsFlowChart');
    if (!chartCanvas) {
        return;
    }

    if (statsFlowChart) {
        statsFlowChart.destroy();
    }

    statsFlowChart = new Chart(chartCanvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: sortedTasks.map(item => item.task),
            datasets: [{
                label: 'Average Days',
                data: sortedTasks.map(item => Number(item.days.toFixed(2)))
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

function renderSupplyStats(stats) {
    const target = document.getElementById('statsSupplySummary');
    if (!target || !stats || !stats.supply) {
        return;
    }

    const suppliers = (stats.supply.suppliers || []).slice(0, 12);
    const rows = suppliers.map(item => {
        return `<tr><td>${item.supplier}</td><td>${item.totalItems}</td><td>${item.ordered}</td><td>${item.delivered}</td><td>${item.pending}</td></tr>`;
    }).join('');

    target.innerHTML = `
        <table class="table table-condensed">
            <thead><tr><th>Supplier</th><th>Total</th><th>Ordered</th><th>Delivered</th><th>Pending</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5">No supplier data in selected range.</td></tr>'}</tbody>
        </table>
    `;

    const chartCanvas = document.getElementById('statsSupplyChart');
    if (!chartCanvas) {
        return;
    }

    if (statsSupplyChart) {
        statsSupplyChart.destroy();
    }

    statsSupplyChart = new Chart(chartCanvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: suppliers.map(item => item.supplier),
            datasets: [
                {
                    label: 'Ordered',
                    data: suppliers.map(item => item.ordered)
                },
                {
                    label: 'Delivered',
                    data: suppliers.map(item => item.delivered)
                },
                {
                    label: 'Pending',
                    data: suppliers.map(item => item.pending)
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}
