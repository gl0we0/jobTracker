const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const path = require('path');

const { loadJobs, getAllJobs, getJobByNumber, getCalendar, upsertCalendarDay, patchJobState, getStats, getJobFiles, uploadJobFile, saveJob, calendarFilePath } = require('../server');

function createMockRes() {
    return {
        statusCode: 200,
        body: null,
        sentFile: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        sendFile(filePath) {
            this.sentFile = filePath;
            return this;
        }
    };
}

test('GET /jobs handler returns an array with 200', async () => {
    await loadJobs();

    const req = {};
    const res = createMockRes();
    getAllJobs(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
});

test('GET /jobs/:jobNumber handler returns 404 for unknown job', async () => {
    await loadJobs();

    const req = { params: { jobNumber: 'does-not-exist' } };
    const res = createMockRes();
    getJobByNumber(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { message: 'Job not found' });
});

test('PATCH /jobs/:jobNumber/state handler validates jobState', async () => {
    await loadJobs();

    const req = {
        params: { jobNumber: '0000' },
        body: { jobState: 'NotAValidState' }
    };
    const res = createMockRes();
    await patchJobState(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: 'Invalid jobState value' });
});

test('PATCH /jobs/:jobNumber/state handler returns 404 for unknown job', async () => {
    await loadJobs();

    const req = {
        params: { jobNumber: 'does-not-exist' },
        body: { jobState: 'Initial' }
    };
    const res = createMockRes();
    await patchJobState(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { message: 'Job not found' });
});

test('GET /stats handler rejects invalid range', async () => {
    await loadJobs();

    const req = { query: { range: 'invalid' } };
    const res = createMockRes();
    getStats(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: 'Invalid range. Use all, or a positive integer number of days.' });
});

test('GET /stats handler returns expected top-level sections', async () => {
    await loadJobs();

    const req = { query: { range: 'all' } };
    const res = createMockRes();
    getStats(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(typeof res.body.generatedAt, 'string');
    assert.equal(res.body.range, 'all');
    assert.equal(typeof res.body.jobCount, 'number');
    assert.ok(res.body.pipeline);
    assert.ok(res.body.flow);
    assert.ok(res.body.timeline);
    assert.ok(res.body.supply);
});

test('GET /calendar handler rejects invalid month format', async () => {
    const req = { query: { month: '2026-3' } };
    const res = createMockRes();

    await getCalendar(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: 'Invalid month. Use YYYY-MM.' });
});

test('PUT /calendar/day/:date persists entries to calendar store', async () => {
    const originalContents = await fs.readFile(calendarFilePath, 'utf8');
    const dateKey = '2026-03-26';
    const entryText = `Calendar test ${Date.now()}`;

    try {
        await loadJobs();

        const saveReq = {
            params: { date: dateKey },
            body: {
                entries: [
                    {
                        text: entryText,
                        time: '09:30',
                        details: 'Smoke test entry',
                        jobNumber: '0000'
                    }
                ]
            }
        };
        const saveRes = createMockRes();
        await upsertCalendarDay(saveReq, saveRes);

        assert.equal(saveRes.statusCode, 200);
        assert.equal(saveRes.body.date, dateKey);
        assert.equal(saveRes.body.entries.length, 1);
        assert.equal(saveRes.body.entries[0].text, entryText);
        assert.equal(saveRes.body.entries[0].jobNumber, '0000');

        const getReq = { query: { month: '2026-03' } };
        const getRes = createMockRes();
        await getCalendar(getReq, getRes);

        assert.equal(getRes.statusCode, 200);
        assert.ok(getRes.body.days[dateKey]);
        assert.equal(getRes.body.days[dateKey][0].text, entryText);
    } finally {
        await fs.writeFile(calendarFilePath, originalContents);
    }
});

test('GET /jobs/:jobNumber/files returns 404 for unknown job', async () => {
    await loadJobs();

    const req = { params: { jobNumber: 'does-not-exist' } };
    const res = createMockRes();
    await getJobFiles(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { message: 'Job not found' });
});

test('GET /jobs/:jobNumber/files excludes Job.json', async () => {
    const jobNumber = '0000';
    const jobPath = path.join(process.cwd(), 'jobs', jobNumber);
    const filename = 'files-list-test.txt';
    await fs.writeFile(path.join(jobPath, filename), 'temporary test file');

    try {
        await loadJobs();
        const req = { params: { jobNumber } };
        const res = createMockRes();
        await getJobFiles(req, res);

        assert.equal(res.statusCode, 200);
        assert.ok(Array.isArray(res.body.files));
        assert.ok(res.body.files.some(file => file.name === filename));
        assert.ok(!res.body.files.some(file => file.name === 'Job.json'));
    } finally {
        await fs.unlink(path.join(jobPath, filename)).catch(() => {});
    }
});

test('POST /jobs/:jobNumber/files uploads and saves file into correct job folder', async () => {
    const jobNumber = '0000';
    const uploadName = `upload-${Date.now()}.txt`;
    const tempUploadPath = path.join('/tmp', `${uploadName}.tmp`);
    const jobFilePath = path.join(process.cwd(), 'jobs', jobNumber, uploadName);
    await fs.writeFile(tempUploadPath, 'uploaded test file');

    try {
        await loadJobs();
        const req = {
            params: { jobNumber },
            file: {
                path: tempUploadPath,
                originalname: uploadName
            }
        };
        const res = createMockRes();
        await uploadJobFile(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.file.name, uploadName);
        const savedContent = await fs.readFile(jobFilePath, 'utf8');
        assert.equal(savedContent, 'uploaded test file');
    } finally {
        await fs.unlink(tempUploadPath).catch(() => {});
        await fs.unlink(jobFilePath).catch(() => {});
    }
});

test('POST /jobs/:jobNumber/files renames duplicate filenames safely', async () => {
    const jobNumber = '0000';
    const filename = `duplicate-${Date.now()}.pdf`;
    const jobPath = path.join(process.cwd(), 'jobs', jobNumber);
    const originalPath = path.join(jobPath, filename);
    const duplicatePath = path.join(jobPath, filename.replace('.pdf', ' (2).pdf'));
    const tempUploadPath = path.join('/tmp', `${filename}.tmp`);
    await fs.writeFile(originalPath, 'existing file');
    await fs.writeFile(tempUploadPath, 'new file');

    try {
        await loadJobs();
        const req = {
            params: { jobNumber },
            file: {
                path: tempUploadPath,
                originalname: filename
            }
        };
        const res = createMockRes();
        await uploadJobFile(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.file.name, filename.replace('.pdf', ' (2).pdf'));
        const savedContent = await fs.readFile(duplicatePath, 'utf8');
        assert.equal(savedContent, 'new file');
    } finally {
        await fs.unlink(tempUploadPath).catch(() => {});
        await fs.unlink(originalPath).catch(() => {});
        await fs.unlink(duplicatePath).catch(() => {});
    }
});

test('POST /jobs/:jobNumber/files rejects invalid upload request', async () => {
    await loadJobs();

    const req = { params: { jobNumber: '0000' } };
    const res = createMockRes();
    await uploadJobFile(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: 'A file upload is required' });
});

test('invoice data survives normal POST/GET job save cycle', async () => {
    const jobNumber = '0000';
    const jobFilePath = path.join(process.cwd(), 'jobs', jobNumber, 'Job.json');
    const originalContents = await fs.readFile(jobFilePath, 'utf8');
    const originalJob = JSON.parse(originalContents);
    const updatedJob = {
        ...originalJob,
        invoice: {
            invoiceNumber: `inv${jobNumber}`,
            issueDate: '2026-03-23',
            customerName: originalJob.customerDetails.name,
            customerAddress: originalJob.customerDetails.address,
            jobReference: jobNumber,
            company: {
                lineSmall: 'LoweCo LTD',
                lineLarge: 'Peter Lowe Fabrics'
            },
            vatRate: 0.2,
            notes: originalJob.notes,
            bankDetails: 'Test Bank',
            businessDetails: 'Test Address',
            lineItems: [{ qty: 1, description: 'Test invoice line', unitCost: 100, lineTotal: 100 }],
            totals: { netTotal: 100, vatTotal: 20, grossTotal: 120 },
            pdfFiles: [`inv${jobNumber}.pdf`],
            updatedAt: '2026-03-23T10:00:00.000Z'
        }
    };

    try {
        await loadJobs();
        const saveReq = {
            params: { jobNumber },
            body: updatedJob
        };
        const saveRes = createMockRes();
        await saveJob(saveReq, saveRes);
        assert.equal(saveRes.statusCode, 201);

        await loadJobs();
        const getReq = { params: { jobNumber } };
        const getRes = createMockRes();
        getJobByNumber(getReq, getRes);
        assert.equal(getRes.statusCode, 200);
        assert.equal(getRes.body.invoice.invoiceNumber, `inv${jobNumber}`);
        assert.equal(getRes.body.invoice.totals.grossTotal, 120);
        assert.deepEqual(getRes.body.invoice.pdfFiles, [`inv${jobNumber}.pdf`]);
    } finally {
        await fs.writeFile(jobFilePath, originalContents);
        await loadJobs();
    }
});
