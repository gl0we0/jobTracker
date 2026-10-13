const express = require('express');
const fs = require('fs').promises; // Use promise-based methods
const multer = require('multer');
const path = require('path');
const archiver = require('archiver');
const crypto = require('crypto');
const app = express();
const upload = multer({ dest: 'uploads/' });

const port = 4000

// Middleware
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// Serve static files from the public directory
app.use(express.static('public'));

// Route to serve the job_view.htm
app.get('/job-view', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'job_view.htm'));
});

// Optional: Serve an index.html as a main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});


// array that contains all our jobs
let jobArray = [];
// Directory for job files
const jobsDir = path.join(__dirname, 'jobs');
const dataDir = path.join(__dirname, 'data');
const calendarFilePath = path.join(dataDir, 'calendar.json');
const curtainPricingFilePath = path.join(dataDir, 'curtain-pricing.json');
const validJobStates = [
    "Initial",
    "Measuring",
    "Needs Quote",
    "Quoted",
    "Going Ahead",
    "Materials Ordered",
    "Making",
    "Fitting",
    "Invoiced",
    "Completed",
    "Rejected",
    "Archived"
];

function getJobIndex(jobNumber) {
    return jobArray.findIndex(job => job.jobNumber.toString() === jobNumber.toString());
}

function getJobPath(jobNumber) {
    const normalized = path.basename(jobNumber.toString());
    return path.join(jobsDir, normalized);
}

function getJobFilePath(jobNumber) {
    return path.join(getJobPath(jobNumber), 'Job.json');
}

function createEmptyCalendarStore() {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        days: {}
    };
}

async function ensureCalendarStoreExists() {
    await fs.mkdir(dataDir, { recursive: true });
    const exists = await fs.access(calendarFilePath).then(() => true).catch(() => false);
    if (!exists) {
        await writeJsonAtomic(calendarFilePath, createEmptyCalendarStore());
    }
}

async function readCalendarStore() {
    await ensureCalendarStoreExists();
    const raw = await fs.readFile(calendarFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Calendar store is invalid');
    }

    return {
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        days: parsed.days && typeof parsed.days === 'object' && !Array.isArray(parsed.days) ? parsed.days : {}
    };
}

async function writeJsonAtomic(filePath, payload) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempFilePath, JSON.stringify(payload, null, 2));
    await fs.rename(tempFilePath, filePath);
}

function finiteNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new Error(`${label} must be a number between ${min} and ${max}`);
    }
    return number;
}

function cleanText(value, fallback, maxLength = 160) {
    const text = typeof value === 'string' ? value.trim() : '';
    return (text || fallback).slice(0, maxLength);
}

function sanitizeCurtainPricingSettings(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Settings must be an object');
    }

    const headingDefaults = {
        pencil: ['Pencil Pleat', 'Standard gathered pencil pleat heading.'],
        triple: ['Triple Pleat', 'Hand-finished triple pleat heading.'],
        eyelet: ['Eyelets', 'Eyelet heading, including a price for each eyelet used.'],
        wave: ['Wave', 'Wave tape heading for 6cm or 8cm carrier spacing.']
    };
    const constructionSource = payload.curtainConstruction;
    if (!constructionSource || typeof constructionSource !== 'object' || Array.isArray(constructionSource)) {
        throw new Error('Missing curtain construction settings');
    }
    const headings = {};
    for (const [key, defaults] of Object.entries(headingDefaults)) {
        const source = payload.headings && payload.headings[key];
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            throw new Error(`Missing heading settings for ${key}`);
        }
        headings[key] = {
            label: cleanText(source.label, defaults[0], 60),
            description: cleanText(source.description, defaults[1]),
            fullness: finiteNumber(source.fullness, `${defaults[0]} fullness`, { min: 1, max: 3.5 }),
            dropAllowanceCm: finiteNumber(source.dropAllowanceCm, `${defaults[0]} drop allowance`, { max: 500 }),
            makingPricePerWidth: finiteNumber(source.makingPricePerWidth, `${defaults[0]} making price`, { max: 100000 })
        };
        if (key === 'eyelet') {
            headings[key].hardwarePriceEach = finiteNumber(source.hardwarePriceEach, 'Eyelet price', { max: 10000 });
        }
    }

    const romanSource = payload.romanBlinds;
    if (!romanSource || typeof romanSource !== 'object' || Array.isArray(romanSource)) {
        throw new Error('Missing Roman blind settings');
    }
    const mechanisms = {};
    for (const key of ['standard', 'electric']) {
        const mechanism = romanSource.mechanisms && romanSource.mechanisms[key];
        if (!mechanism || !Array.isArray(mechanism.rows) || mechanism.rows.length === 0) {
            throw new Error(`${key} mechanism requires at least one price band`);
        }
        const rows = mechanism.rows.map((row, index) => ({
            maximumWidthCm: finiteNumber(row && row.maximumWidthCm, `${key} row ${index + 1} maximum width`, { min: 1, max: 10000 }),
            price: finiteNumber(row && row.price, `${key} row ${index + 1} price`, { max: 100000 })
        })).sort((a, b) => a.maximumWidthCm - b.maximumWidthCm);
        if (new Set(rows.map(row => row.maximumWidthCm)).size !== rows.length) {
            throw new Error(`${key} mechanism maximum widths must be unique`);
        }
        mechanisms[key] = {
            label: cleanText(mechanism.label, key === 'standard' ? 'Standard Chain System' : 'Electric System', 80),
            rows
        };
    }

    const liningSource = payload.linings;
    if (!liningSource || !Array.isArray(liningSource.options) || liningSource.options.length === 0) {
        throw new Error('At least one lining option is required');
    }
    const ids = new Set();
    const options = liningSource.options.map((option, index) => {
        const id = cleanText(option && option.id, `lining-${index + 1}`, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        if (ids.has(id)) throw new Error('Lining option names must be unique');
        ids.add(id);
        return {
            id,
            label: cleanText(option && option.label, `Lining ${index + 1}`, 80),
            pricePerMetre: finiteNumber(option && option.pricePerMetre, `Lining ${index + 1} price`, { max: 100000 })
        };
    });

    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        curtainConstruction: {
            widthAllowancePerFinishedCurtainCm: finiteNumber(
                constructionSource.widthAllowancePerFinishedCurtainCm,
                'Curtain width allowance per finished curtain',
                { max: 500 }
            )
        },
        headings,
        romanBlinds: {
            label: cleanText(romanSource.label, 'Roman Blinds', 80),
            description: cleanText(romanSource.description, 'Allowances, making charges and mechanism price bands.'),
            dropAllowanceCm: finiteNumber(romanSource.dropAllowanceCm, 'Roman blind drop allowance', { max: 500 }),
            widthAllowanceCm: finiteNumber(romanSource.widthAllowanceCm, 'Roman blind width allowance', { max: 500 }),
            baseMakingPrice: finiteNumber(romanSource.baseMakingPrice, 'Roman blind base making price', { max: 100000 }),
            makingPricePerWidth: finiteNumber(romanSource.makingPricePerWidth, 'Roman blind making price per width', { max: 100000 }),
            mechanisms
        },
        linings: {
            label: cleanText(liningSource.label, 'Lining Options', 80),
            description: cleanText(liningSource.description, 'Lining choices and their price per metre.'),
            options
        }
    };
}

async function readCurtainPricingSettings() {
    const raw = await fs.readFile(curtainPricingFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    const settings = sanitizeCurtainPricingSettings(parsed);
    if (typeof parsed.updatedAt === 'string') settings.updatedAt = parsed.updatedAt;
    return settings;
}

async function getCurtainPricingSettings(req, res) {
    try {
        return res.status(200).json(await readCurtainPricingSettings());
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load curtain pricing settings', error: error.message });
    }
}

async function updateCurtainPricingSettings(req, res) {
    try {
        const settings = sanitizeCurtainPricingSettings(req.body);
        await writeJsonAtomic(curtainPricingFilePath, settings);
        return res.status(200).json({ message: 'Curtain pricing settings saved', settings });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
}

app.get('/settings/curtain-pricing', getCurtainPricingSettings);
app.put('/settings/curtain-pricing', updateCurtainPricingSettings);

function normalizeMonthKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) {
        return null;
    }

    const [yearRaw, monthRaw] = value.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return null;
    }

    return `${yearRaw}-${monthRaw}`;
}

function normalizeDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }

    const [yearRaw, monthRaw, dayRaw] = value.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        Number.isNaN(date.getTime()) ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return `${yearRaw}-${monthRaw}-${dayRaw}`;
}

function normalizeCalendarTime(value) {
    if (value == null || value === '') {
        return '';
    }

    if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
        return null;
    }

    const [hoursRaw, minutesRaw] = value.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    return `${hoursRaw}:${minutesRaw}`;
}

function sanitizeCalendarEntries(entries) {
    if (!Array.isArray(entries)) {
        return { error: 'entries must be an array' };
    }

    const sanitizedEntries = [];

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return { error: 'Each calendar entry must be an object' };
        }

        const text = typeof entry.text === 'string' ? entry.text.trim() : '';
        const details = typeof entry.details === 'string' ? entry.details.trim() : '';
        const time = normalizeCalendarTime(entry.time);
        const endTime = normalizeCalendarTime(entry.endTime);
        const jobNumber = entry.jobNumber == null || entry.jobNumber === '' ? '' : String(entry.jobNumber).trim();
        const status = entry.status === 'archived' ? 'archived' : 'active';

        if (!text) {
            return { error: 'Each calendar entry requires text' };
        }

        if (time === null || endTime === null) {
            return { error: 'time and endTime must use HH:MM format' };
        }

        if (jobNumber && getJobIndex(jobNumber) === -1) {
            return { error: `Linked job ${jobNumber} was not found` };
        }

        const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
        sanitizedEntries.push({
            id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : crypto.randomUUID(),
            text,
            time,
            endTime,
            details,
            jobNumber,
            status,
            createdAt,
            updatedAt: new Date().toISOString()
        });
    }

    sanitizedEntries.sort((left, right) => {
        const leftTime = left.time || '99:99';
        const rightTime = right.time || '99:99';
        if (leftTime !== rightTime) {
            return leftTime.localeCompare(rightTime);
        }
        return left.createdAt.localeCompare(right.createdAt);
    });

    return { entries: sanitizedEntries };
}

function filterCalendarDaysByMonth(days, monthKey) {
    if (!monthKey) {
        return days;
    }

    return Object.keys(days).reduce((accumulator, dateKey) => {
        if (dateKey.startsWith(`${monthKey}-`)) {
            accumulator[dateKey] = days[dateKey];
        }
        return accumulator;
    }, {});
}

function getFileKind(filename) {
    const extension = path.extname(filename).toLowerCase();
    if (extension === '.pdf') {
        return 'pdf';
    }
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(extension)) {
        return 'image';
    }
    if (['.dwg', '.dxf'].includes(extension)) {
        return 'drawing';
    }
    return extension ? extension.slice(1) : 'file';
}

async function getFileMetadata(jobNumber, filename) {
    const filePath = path.join(getJobPath(jobNumber), filename);
    const stat = await fs.stat(filePath);
    return {
        name: filename,
        relativePath: filename,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        kind: getFileKind(filename)
    };
}

async function listJobFiles(jobNumber) {
    const jobPath = getJobPath(jobNumber);
    const entries = await fs.readdir(jobPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (!entry.isFile() || entry.name === 'Job.json') {
            continue;
        }
        files.push(await getFileMetadata(jobNumber, entry.name));
    }

    return files.sort((a, b) => a.name.localeCompare(b.name));
}

async function createCollisionSafeFilename(jobNumber, originalName) {
    const parsed = path.parse(originalName);
    const baseName = parsed.name || 'file';
    const extension = parsed.ext || '';
    let candidate = `${baseName}${extension}`;
    let attempt = 2;

    while (await fs.access(path.join(getJobPath(jobNumber), candidate)).then(() => true).catch(() => false)) {
        candidate = `${baseName} (${attempt})${extension}`;
        attempt += 1;
    }

    return candidate;
}

async function moveFile(sourcePath, destinationPath) {
    try {
        await fs.rename(sourcePath, destinationPath);
    } catch (error) {
        if (error && error.code === 'EXDEV') {
            await fs.copyFile(sourcePath, destinationPath);
            await fs.unlink(sourcePath);
            return;
        }
        throw error;
    }
}

async function ensureJobExists(jobNumber) {
    const jobIndex = getJobIndex(jobNumber);
    if (jobIndex === -1) {
        return null;
    }

    const jobPath = getJobPath(jobNumber);
    await fs.mkdir(jobPath, { recursive: true });
    return { jobIndex, jobPath };
}



// Load all jobs synchronously within the async function
async function loadJobs() {
    try {
        jobArray = [];
        const files = await fs.readdir(jobsDir);
        for (let file of files) {
            const filePath = path.join(jobsDir, file, 'Job.json');
            if (await fs.stat(filePath).then(stat => stat.isFile()).catch(() => false)) {
                const data = await fs.readFile(filePath, 'utf8');
                jobArray.push(JSON.parse(data));
            }
        }
    } catch (err) {
        console.error('Failed to load jobs:', err);
    }
}

// Get all jobs
function getAllJobs(req, res) {
    res.json(jobArray);
}

app.get('/jobs', getAllJobs);

function parseRangeDays(rangeRaw) {
    if (!rangeRaw || rangeRaw === 'all') {
        return null;
    }

    const days = Number(rangeRaw);
    if (!Number.isInteger(days) || days <= 0) {
        return null;
    }

    return days;
}

function getLastTimelineDate(job) {
    if (!job.timeline || job.timeline.length === 0) {
        return null;
    }

    const latest = job.timeline.reduce((latestDate, entry) => {
        const date = new Date(entry.time);
        if (Number.isNaN(date.getTime())) {
            return latestDate;
        }
        return !latestDate || date > latestDate ? date : latestDate;
    }, null);

    return latest;
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function computeStats(jobs) {
    const stateCounts = {};
    const stateCosts = {};
    let ongoingTotalCost = 0;
    let ongoingJobCount = 0;
    const ongoingStates = ["Going Ahead", "Materials Ordered", "Making", "Fitting"];
    const timelineStats = {};
    let totalJobDurations = 0;
    let totalCompletedJobs = 0;
    const taskDurations = {};
    const supplierMetrics = {};
    const activeJobs = jobs.filter(job => job.jobState !== "Archived");

    activeJobs.forEach(job => {
        stateCounts[job.jobState] = (stateCounts[job.jobState] || 0) + 1;
        const jobCost = toNumber(job.jobCost);
        stateCosts[job.jobState] = (stateCosts[job.jobState] || 0) + jobCost;

        if (ongoingStates.includes(job.jobState)) {
            ongoingTotalCost += jobCost;
            ongoingJobCount += 1;
        }

        if (Array.isArray(job.orderItems)) {
            job.orderItems.forEach(item => {
                const supplierName = item && item.supplier ? item.supplier : 'Unknown';
                if (!supplierMetrics[supplierName]) {
                    supplierMetrics[supplierName] = {
                        supplier: supplierName,
                        totalItems: 0,
                        ordered: 0,
                        delivered: 0
                    };
                }

                supplierMetrics[supplierName].totalItems += 1;
                if (item.ordered) {
                    supplierMetrics[supplierName].ordered += 1;
                }
                if (item.delivered) {
                    supplierMetrics[supplierName].delivered += 1;
                }
            });
        }

        if (!Array.isArray(job.timeline)) {
            return;
        }

        let goingAheadDate = null;
        let completedDate = null;
        let previousDate = null;
        let previousLabel = '';
        let earliestDate = null;

        job.timeline.forEach(action => {
            const date = new Date(action.time);
            if (Number.isNaN(date.getTime())) {
                return;
            }

            if (!earliestDate || date < earliestDate) {
                earliestDate = date;
            }

            const month = date.toLocaleString('default', { month: 'long', year: 'numeric' });
            if (!timelineStats[month]) {
                timelineStats[month] = { count: 0, actions: {} };
            }
            timelineStats[month].count += 1;
            timelineStats[month].actions[action.label] = (timelineStats[month].actions[action.label] || 0) + 1;

            if (previousDate && previousLabel !== action.label) {
                const duration = (date - previousDate) / (1000 * 60 * 60 * 24);
                const task = `${previousLabel} to ${action.label}`;
                taskDurations[task] = taskDurations[task] || [];
                taskDurations[task].push(duration);
            }

            if (action.label && action.label.includes("Job Updated: Going Ahead")) {
                goingAheadDate = date;
            } else if (action.label && action.label.includes("Job Updated: Completed")) {
                completedDate = date;
                if (goingAheadDate === null) {
                    goingAheadDate = earliestDate;
                }
                if (goingAheadDate) {
                    const jobDuration = (completedDate - goingAheadDate) / (1000 * 60 * 60 * 24);
                    totalJobDurations += jobDuration;
                    totalCompletedJobs += 1;
                }
            }

            previousDate = date;
            previousLabel = action.label || '';
        });
    });

    const averageTaskDurations = {};
    Object.keys(taskDurations).forEach(task => {
        const totalDuration = taskDurations[task].reduce((acc, duration) => acc + duration, 0);
        averageTaskDurations[task] = totalDuration / taskDurations[task].length;
    });

    const supplierBreakdown = Object.values(supplierMetrics).map(entry => ({
        ...entry,
        pending: Math.max(0, entry.totalItems - entry.delivered)
    })).sort((a, b) => b.totalItems - a.totalItems);

    return {
        pipeline: {
            totalActiveJobs: activeJobs.length,
            stateCounts,
            stateCosts,
            ongoing: {
                states: ongoingStates,
                jobCount: ongoingJobCount,
                totalCost: ongoingTotalCost
            }
        },
        flow: {
            averageJobDurationDays: totalCompletedJobs > 0 ? totalJobDurations / totalCompletedJobs : 0,
            completedJobsMeasured: totalCompletedJobs,
            averageTaskDurations
        },
        timeline: {
            byMonth: timelineStats
        },
        supply: {
            suppliers: supplierBreakdown
        }
    };
}

function getStats(req, res) {
    const rangeRaw = req.query ? req.query.range : undefined;
    const rangeDays = parseRangeDays(rangeRaw);

    if (rangeRaw && rangeRaw !== 'all' && rangeDays === null) {
        return res.status(400).json({ message: 'Invalid range. Use all, or a positive integer number of days.' });
    }

    let scopedJobs = jobArray;
    if (rangeDays !== null) {
        const cutoff = new Date(Date.now() - (rangeDays * 24 * 60 * 60 * 1000));
        scopedJobs = jobArray.filter(job => {
            const lastTimelineDate = getLastTimelineDate(job);
            return lastTimelineDate && lastTimelineDate >= cutoff;
        });
    }

    const stats = computeStats(scopedJobs);
    return res.status(200).json({
        generatedAt: new Date().toISOString(),
        range: rangeDays === null ? 'all' : `${rangeDays}d`,
        jobCount: scopedJobs.length,
        ...stats
    });
}

app.get('/stats', getStats);

async function getCalendar(req, res) {
    const month = req.query ? req.query.month : undefined;
    const monthKey = month == null || month === '' ? null : normalizeMonthKey(month);

    if (month != null && month !== '' && !monthKey) {
        return res.status(400).json({ message: 'Invalid month. Use YYYY-MM.' });
    }

    try {
        const store = await readCalendarStore();
        return res.status(200).json({
            month: monthKey,
            updatedAt: store.updatedAt,
            days: filterCalendarDaysByMonth(store.days, monthKey)
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load calendar', error: error.message });
    }
}

app.get('/calendar', getCalendar);

async function upsertCalendarDay(req, res) {
    const dateKey = normalizeDateKey(req.params ? req.params.date : '');
    if (!dateKey) {
        return res.status(400).json({ message: 'Invalid date. Use YYYY-MM-DD.' });
    }

    const { entries, error } = sanitizeCalendarEntries(req.body ? req.body.entries : undefined);
    if (error) {
        return res.status(400).json({ message: error });
    }

    try {
        const store = await readCalendarStore();
        if (entries.length === 0) {
            delete store.days[dateKey];
        } else {
            store.days[dateKey] = entries;
        }
        store.updatedAt = new Date().toISOString();
        await writeJsonAtomic(calendarFilePath, store);
        return res.status(200).json({
            message: 'Calendar day saved successfully',
            date: dateKey,
            updatedAt: store.updatedAt,
            entries: store.days[dateKey] || []
        });
    } catch (saveError) {
        return res.status(500).json({ message: 'Failed to save calendar day', error: saveError.message });
    }
}

app.put('/calendar/day/:date', upsertCalendarDay);

async function patchJobState(req, res) {
    const jobNumber = req.params.jobNumber;
    const nextState = req.body ? req.body.jobState : undefined;

    if (typeof nextState !== 'string' || nextState.trim() === '') {
        return res.status(400).json({ message: 'jobState is required' });
    }

    if (!validJobStates.includes(nextState)) {
        return res.status(400).json({ message: 'Invalid jobState value' });
    }

    const jobIndex = getJobIndex(jobNumber);
    if (jobIndex === -1) {
        return res.status(404).json({ message: 'Job not found' });
    }

    const currentJob = jobArray[jobIndex];
    if (currentJob.jobState === nextState) {
        return res.status(200).json({ message: 'State unchanged', job: currentJob });
    }

    const jobPath = getJobPath(jobNumber);
    const jobFile = getJobFilePath(jobNumber);
    const updatedJob = {
        ...currentJob,
        jobState: nextState
    };

    addToTimeline(updatedJob, `Job Updated: ${nextState}`);

    try {
        await fs.writeFile(jobFile, JSON.stringify(updatedJob, null, 2));
        jobArray[jobIndex] = updatedJob;
        res.status(200).json({ message: 'Job state updated successfully', job: updatedJob });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update job state', error });
    }
}

app.patch('/jobs/:jobNumber/state', patchJobState);

async function getJobFiles(req, res) {
    const jobNumber = req.params.jobNumber;
    const jobContext = await ensureJobExists(jobNumber);

    if (!jobContext) {
        return res.status(404).json({ message: 'Job not found' });
    }

    try {
        const files = await listJobFiles(jobNumber);
        return res.status(200).json({ jobNumber, files });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to list job files', error });
    }
}

app.get('/jobs/:jobNumber/files', getJobFiles);

async function downloadJobFile(req, res) {
    const jobNumber = req.params.jobNumber;
    const filename = path.basename(req.params.filename || '');
    const jobContext = await ensureJobExists(jobNumber);

    if (!jobContext) {
        return res.status(404).json({ message: 'Job not found' });
    }

    if (!filename) {
        return res.status(400).json({ message: 'filename is required' });
    }

    const filePath = path.join(jobContext.jobPath, filename);
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) {
        return res.status(404).json({ message: 'File not found' });
    }

    return res.sendFile(filePath);
}

app.get('/jobs/:jobNumber/files/:filename', downloadJobFile);

async function uploadJobFile(req, res) {
    const jobNumber = req.params.jobNumber;
    const jobContext = await ensureJobExists(jobNumber);

    if (!jobContext) {
        if (req.file) {
            await fs.unlink(req.file.path).catch(() => {});
        }
        return res.status(404).json({ message: 'Job not found' });
    }

    if (!req.file || !req.file.originalname) {
        return res.status(400).json({ message: 'A file upload is required' });
    }

    const safeOriginalName = path.basename(req.file.originalname);
    const filename = await createCollisionSafeFilename(jobNumber, safeOriginalName);
    const destination = path.join(jobContext.jobPath, filename);

    try {
        await moveFile(req.file.path, destination);
        const file = await getFileMetadata(jobNumber, filename);
        return res.status(201).json({ message: 'File uploaded successfully', file });
    } catch (error) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(500).json({ message: 'Failed to upload file', error });
    }
}

app.post('/jobs/:jobNumber/files', upload.single('file'), uploadJobFile);
 
//save job Data
async function saveJob(req, res) {
    let jobNumber = req.params.jobNumber;
    let jobPath, isNewJob = false, indexToUpdate;

    if (!jobNumber || jobNumber === 'new') {
        // Handle creating a new job
        const lastJobNumber = jobArray.reduce((max, job) => Math.max(max, job.jobNumber), 0);
        jobNumber = lastJobNumber + 1;
        jobPath = getJobPath(jobNumber);
        isNewJob = true;
        console.log("New job. Number: " + jobNumber);
    } else {
        // Handle updating an existing job
        jobPath = getJobPath(jobNumber);
        indexToUpdate = getJobIndex(jobNumber);
        if (indexToUpdate === -1) {
            return res.status(404).json({ message: 'Job not found' });
        }
    }

    const jobFile = getJobFilePath(jobNumber);
    const jobData = {
        ...req.body,
        jobNumber: jobNumber  // Ensure jobNumber is correctly set
    };

    try {
        // Ensure the directory exists, create if not
        await fs.mkdir(jobPath, { recursive: true });

        // Add a timeline entry
        addToTimeline(jobData, isNewJob ? `Job Created: ${jobData.jobState}` : `Job Updated: ${jobData.jobState}`);

        // Write job data to Job.json
        await fs.writeFile(jobFile, JSON.stringify(jobData, null, 2));

        // Update jobArray for new or existing jobs
        if (isNewJob) {
            jobArray.push(jobData);
        } else {
            jobArray[indexToUpdate] = jobData;
        }

        // Handle file upload if present
        if (req.file) {
            const fileDestination = path.join(jobPath, req.file.originalname);
            await moveFile(req.file.path, fileDestination);
        }

        res.status(201).json({ message: 'Job saved successfully', jobNumber: jobNumber });
    } catch (error) {
        res.status(500).json({ message: 'Failed to save job', error });
    }
}

app.post('/jobs/:jobNumber?', upload.single('file'), saveJob);
// Get a specific job using the in-memory array
function getJobByNumber(req, res) {
    const jobNumber = req.params.jobNumber;
    const job = jobArray.find(job => job.jobNumber.toString() === jobNumber);

    if (job) {
        res.status(200).json(job);
    } else {
        res.status(404).json({ message: 'Job not found' });
    }
}

app.get('/jobs/:jobNumber', getJobByNumber);

// ###############################################################
// Download backup of job folder
// ###############################################################
app.get('/backup-download', (req, res) => {
    console.log("Backup download start");
    // Set the headers

    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename=jobsBackup.zip'
    });

    // Create a zip archive using archiver
    const archive = archiver('zip', {
        zlib: { level: 9 } // Set the compression level
    });

    archive.on('error', (err) => {
        res.status(500).send({error: err.message});
    });

    // Pipe archive data to the response
    archive.pipe(res);

    // Append files from a directory
    archive.directory('./jobs/', false);
    
    // Finalize the archive (this is where the archive is actually generated)
    archive.finalize();
});


/// ##############################################################

function addToTimeline(jobData, label) {
    if (!jobData.timeline) {
        jobData.timeline = [];  // Initialize timeline if it doesn't exist
    }
    const newEntry = {
        label: label,
        time: new Date().toISOString()  // Capture the current date and time
    };

    jobData.timeline.push(newEntry);  // Add the new entry to the timeline
}


async function startServer() {
    await loadJobs();
    return app.listen(port, '0.0.0.0', () => {
        console.log(`App listening at http://localhost:${port}`);
    });
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = {
    app,
    calendarFilePath,
    curtainPricingFilePath,
    loadJobs,
    startServer,
    getAllJobs,
    getJobByNumber,
    getCalendar,
    upsertCalendarDay,
    getCurtainPricingSettings,
    updateCurtainPricingSettings,
    sanitizeCurtainPricingSettings,
    patchJobState,
    getStats,
    getJobFiles,
    uploadJobFile,
    saveJob
};

