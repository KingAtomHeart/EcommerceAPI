const User = require('../models/User.js');
const bcrypt = require('bcrypt');
const auth = require('../auth.js');
const { OAuth2Client } = require('google-auth-library');
const { errorHandler } = auth;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;


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

        if (!user.password) {
            return res.status(401).json({ error: 'This account uses Google sign-in. Continue with Google.' });
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


// ─── Google Login ────────────────────────────────────────────────────────────
module.exports.googleLogin = async (req, res) => {
    try {
        if (!googleClient) {
            return res.status(500).json({ error: 'Google sign-in is not configured on the server.' });
        }
        const { credential } = req.body;
        if (!credential) {
            return res.status(400).json({ error: 'Missing Google credential.' });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload?.email || !payload.email_verified) {
            return res.status(401).json({ error: 'Google account email is not verified.' });
        }

        const email = payload.email.toLowerCase();
        const googleId = payload.sub;

        let user = await User.findOne({ $or: [{ googleId }, { email }] });
        if (user) {
            if (!user.googleId) { user.googleId = googleId; await user.save(); }
        } else {
            user = await new User({
                firstName: payload.given_name || 'User',
                lastName: payload.family_name || '',
                email,
                googleId,
            }).save();
        }

        return res.status(200).json({
            message: 'Logged in successfully.',
            access: auth.createAccessToken(user),
        });
    } catch (error) {
        if (error.message?.includes('Token used too late') || error.message?.includes('Invalid token')) {
            return res.status(401).json({ error: 'Invalid or expired Google token.' });
        }
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


// ─── Update Mobile Number ────────────────────────────────────────────────────
module.exports.updateMobile = async (req, res) => {
    try {
        const { mobileNo } = req.body;
        if (!mobileNo || !/^\d{11}$/.test(mobileNo)) {
            return res.status(400).json({ error: 'Mobile number must be exactly 11 digits.' });
        }
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { mobileNo },
            { new: true }
        ).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        return res.status(200).json({ message: 'Mobile number updated.', user });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Profile Picture ─────────────────────────────────────────────────────────
module.exports.updateProfilePicture = async (req, res) => {
    try {
        const { url } = req.body || {};
        // Empty string allowed (clearing the avatar). Otherwise require a reasonable-looking URL.
        if (url && typeof url !== 'string') return res.status(400).json({ error: 'Invalid image URL.' });
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { profilePicture: url || '' },
            { new: true }
        ).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        return res.status(200).json({ message: 'Profile picture updated.', user });
    } catch (error) { errorHandler(error, req, res); }
};


// ─── Addresses ────────────────────────────────────────────────────────────────
const validateAddr = (a) => a?.fullName && a?.phone && a?.street && a?.city && a?.province;

module.exports.addAddress = async (req, res) => {
    try {
        const { address } = req.body || {};
        if (!validateAddr(address)) return res.status(400).json({ error: 'Incomplete address.' });
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const isFirst = !user.addresses || user.addresses.length === 0;
        const wantsDefault = !!address.isDefault || isFirst;
        if (wantsDefault) user.addresses.forEach(a => { a.isDefault = false; });

        user.addresses.push({
            fullName: address.fullName, phone: address.phone,
            street: address.street, city: address.city,
            province: address.province, postalCode: address.postalCode || '',
            isDefault: wantsDefault,
        });
        await user.save();
        return res.status(201).json({ addresses: user.addresses });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.updateAddress = async (req, res) => {
    try {
        const { address } = req.body || {};
        if (!validateAddr(address)) return res.status(400).json({ error: 'Incomplete address.' });
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const target = user.addresses.id(req.params.addressId);
        if (!target) return res.status(404).json({ error: 'Address not found.' });

        if (address.isDefault) user.addresses.forEach(a => { a.isDefault = false; });
        Object.assign(target, {
            fullName: address.fullName, phone: address.phone,
            street: address.street, city: address.city,
            province: address.province, postalCode: address.postalCode || '',
            isDefault: !!address.isDefault || target.isDefault,
        });
        // Ensure at least one default remains
        if (!user.addresses.some(a => a.isDefault) && user.addresses.length > 0) {
            user.addresses[0].isDefault = true;
        }
        await user.save();
        return res.status(200).json({ addresses: user.addresses });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.deleteAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const target = user.addresses.id(req.params.addressId);
        if (!target) return res.status(404).json({ error: 'Address not found.' });
        const wasDefault = target.isDefault;
        user.addresses.pull(req.params.addressId);
        if (wasDefault && user.addresses.length > 0) user.addresses[0].isDefault = true;
        await user.save();
        return res.status(200).json({ addresses: user.addresses });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.setDefaultAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const target = user.addresses.id(req.params.addressId);
        if (!target) return res.status(404).json({ error: 'Address not found.' });
        user.addresses.forEach(a => { a.isDefault = false; });
        target.isDefault = true;
        await user.save();
        return res.status(200).json({ addresses: user.addresses });
    } catch (error) { errorHandler(error, req, res); }
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
