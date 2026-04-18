const User = require('../models/User.js');
const bcrypt = require('bcrypt');
const auth = require('../auth.js');
const { errorHandler } = auth;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


// ─── Register ────────────────────────────────────────────────────────────────
module.exports.registerUser = async (req, res) => {
    try {
        const { firstName, lastName, email, mobileNo, password } = req.body;

        if (!EMAIL_REGEX.test(email)) {
            return res.status(400).json({ error: 'Invalid email format.' });
        }
        if (!mobileNo || mobileNo.length !== 11) {
            return res.status(400).json({ error: 'Mobile number must be exactly 11 digits.' });
        }
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(409).json({ error: 'Email is already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ firstName, lastName, email, mobileNo, password: hashedPassword });
        const saved = await newUser.save();

        const userObj = saved.toObject();
        delete userObj.password;

        return res.status(201).json({ message: 'Registered successfully.', user: userObj });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Login ───────────────────────────────────────────────────────────────────
module.exports.loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!EMAIL_REGEX.test(email)) {
            return res.status(400).json({ error: 'Invalid email format.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'No account found with that email.' });
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) {
            return res.status(401).json({ error: 'Incorrect password.' });
        }

        return res.status(200).json({
            message: 'Logged in successfully.',
            access: auth.createAccessToken(user)
        });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Get Profile ──────────────────────────────────────────────────────────────
module.exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        return res.status(200).json({ user });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Update Password ─────────────────────────────────────────────────────────
module.exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters.' });
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        return res.status(200).json({ message: 'Password updated successfully.' });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Set User as Admin (Admin only) ──────────────────────────────────────────
module.exports.updateUserAsAdmin = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isAdmin: true },
            { new: true }
        ).select('-password');

        if (!user) return res.status(404).json({ error: 'User not found.' });

        return res.status(200).json({ message: 'User promoted to admin.', user });
    } catch (error) {
        errorHandler(error, req, res);
    }
};
