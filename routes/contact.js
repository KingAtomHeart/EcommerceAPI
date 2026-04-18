const express = require('express');
const router = express.Router();
const ContactMessage = require('../models/ContactMessage');
const { verify, verifyAdmin } = require('../auth');

// POST /b1/contact — public: save a contact form submission
router.post('/', async (req, res) => {
    const { formType, fields } = req.body;

    if (!formType || !fields || typeof fields !== 'object') {
        return res.status(400).json({ error: 'formType and fields are required' });
    }

    try {
        const message = await ContactMessage.create({ formType, fields });
        res.status(201).json({ message: 'Message received', id: message._id });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save message' });
    }
});

// GET /b1/contact — admin: fetch all messages, newest first
router.get('/', verify, verifyAdmin, async (req, res) => {
    try {
        const messages = await ContactMessage.find().sort({ createdAt: -1 });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// PATCH /b1/contact/:id/status — admin: update status
router.patch('/:id/status', verify, verifyAdmin, async (req, res) => {
    const { status } = req.body;
    if (!['new', 'read', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    try {
        const msg = await ContactMessage.findByIdAndUpdate(req.params.id, { status }, { new: true });
        if (!msg) return res.status(404).json({ error: 'Message not found' });
        res.json(msg);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update status' });
    }
});

module.exports = router;
