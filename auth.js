const jwt = require('jsonwebtoken');
require('dotenv').config();

// ─── Token Creation ───────────────────────────────────────────────────────────
module.exports.createAccessToken = (user) => {
    const data = {
        id: user._id,
        email: user.email,
        isAdmin: user.isAdmin
    };
    return jwt.sign(data, process.env.JWT_SECRET_KEY, { expiresIn: '1d' });
};

// ─── Token Verification ───────────────────────────────────────────────────────
module.exports.verify = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ auth: 'Failed', message: 'No token provided.' });
    }

    const token = authHeader.slice(7);

    jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decodedToken) => {
        if (err) {
            return res.status(403).json({ auth: 'Failed', message: err.message });
        }
        req.user = decodedToken;
        next();
    });
};

// ─── Admin Guard ──────────────────────────────────────────────────────────────
module.exports.verifyAdmin = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        return res.status(403).json({ auth: 'Failed', message: 'Action forbidden. Admins only.' });
    }
};

// ─── Logged-In Guard ─────────────────────────────────────────────────────────
module.exports.isLoggedIn = (req, res, next) => {
    if (req.user) {
        next();
    } else {
        res.sendStatus(401);
    }
};

// ─── Global Error Handler ─────────────────────────────────────────────────────
// FIX: Return { error: "string" } to match every controller response and the
//      client's apiFetch which does:  throw new Error(data.error || data.message)
//      The old version returned { error: { message, errorCode, details } } which
//      caused toast messages to display "[object Object]".
module.exports.errorHandler = (err, req, res, next) => {
    console.error(err);

    const statusCode = err.status || 500;
    const errorMessage = err.message || 'Internal Server Error';

    // Avoid sending duplicate headers if response already started
    if (res.headersSent) {
        return next ? next(err) : undefined;
    }

    res.status(statusCode).json({
        error: errorMessage
    });
};