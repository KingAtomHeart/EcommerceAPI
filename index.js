const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const userRoutes = require('./routes/user');
const productRoutes = require('./routes/product');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/order');
const groupBuyRoutes = require('./routes/groupBuy');
const uploadRoutes = require('./routes/upload');
const homepageRoutes = require('./routes/homepageContent');
const contactRoutes = require('./routes/contact');
const { errorHandler } = require('./auth');

const app = express();

// ─── Database ─────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_STRING)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch((err) => console.error('MongoDB connection error:', err));

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true }));

const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['http://localhost:3000'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/b1/users', userRoutes);
app.use('/b1/products', productRoutes);
app.use('/b1/cart', cartRoutes);
app.use('/b1/orders', orderRoutes);
app.use('/b1/group-buys', groupBuyRoutes);
app.use('/b1/upload', uploadRoutes);
app.use('/b1/homepage', homepageRoutes);
app.use('/b1/contact', contactRoutes);

// Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
if (require.main === module) {
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`API running on port ${PORT}`));
}

module.exports = { app, mongoose };