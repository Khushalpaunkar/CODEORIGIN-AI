const mongoose = require('mongoose');
const crypto = require('crypto');

const fileNodeSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        path: { type: String, required: true },
        type: { type: String, enum: ['file', 'folder'], required: true },
        ext: { type: String, default: '' },
        size: { type: Number, default: 0 },
        lines: { type: Number, default: 0 },
        supported: { type: Boolean, default: false },
        content: { type: String, default: null },
        contentTruncated: { type: Boolean, default: false },
    },
    { _id: false }
);

fileNodeSchema.add({
    children: { type: [fileNodeSchema], default: undefined },
});

const languageSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        files: { type: Number, default: 0 },
        lines: { type: Number, default: 0 },
        percent: { type: Number, default: 0 },
    },
    { _id: false }
);

const analysisSchema = new mongoose.Schema(
    {
        analysisId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        repository: {
            url: { type: String, required: true },
            owner: { type: String, required: true },
            name: { type: String, required: true },
            defaultBranch: { type: String, default: '' },
            description: { type: String, default: '' },
            visibility: { type: String, default: 'public' },
            lastUpdated: { type: Date, default: null },
        },
        status: {
            type: String,
            enum: ['processing', 'completed', 'empty', 'failed'],
            default: 'processing',
        },
        errorMessage: { type: String, default: '' },
        stats: {
            totalFiles: { type: Number, default: 0 },
            totalFolders: { type: Number, default: 0 },
            supportedFiles: { type: Number, default: 0 },
            totalLines: { type: Number, default: 0 },
            blankLines: { type: Number, default: 0 },
            commentLines: { type: Number, default: 0 },
            codeLines: { type: Number, default: 0 },
            languages: { type: [languageSchema], default: [] },
        },
        fileTree: { type: [fileNodeSchema], default: [] },
        startedAt: { type: Date, default: Date.now },
        completedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

analysisSchema.statics.generateId = function () {
    return crypto.randomBytes(9).toString('hex');
};

module.exports = mongoose.model('Analysis', analysisSchema);
