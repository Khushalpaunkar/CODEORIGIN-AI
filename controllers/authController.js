const User = require('../models/User');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

const setFlash = (req, type, message) => {
    req.session.flash = { type, message };
};

const renderLogin = (req, res, errors, form, flash) => {
    if (flash) res.locals.flashMsg = flash;
    res.status(errors ? 422 : 200).render('auth/login', {
        pageTitle: 'Sign In | CodeOrigin AI',
        errors: errors || {},
        form: form || {},
        next: req.query.next || '',
    });
};

const renderRegister = (req, res, errors, form, flash) => {
    if (flash) res.locals.flashMsg = flash;
    res.status(errors ? 422 : 200).render('auth/register', {
        pageTitle: 'Create Account | CodeOrigin AI',
        errors: errors || {},
        form: form || {},
    });
};

exports.getLogin = (req, res) => {
    if (req.query.logged_out === '1') {
        return renderLogin(
            req,
            res,
            null,
            { identifier: '', password: '' },
            { type: 'success', message: 'You have been logged out successfully.' }
        );
    }
    renderLogin(req, res, null, { identifier: '', password: '' });
};

exports.getRegister = (req, res) => {
    renderRegister(req, res, null, {
        name: '',
        email: '',
        username: '',
        password: '',
        confirmPassword: '',
    });
};

exports.postRegister = async (req, res) => {
    const form = {
        name: (req.body.name || '').trim(),
        email: (req.body.email || '').trim().toLowerCase(),
        username: (req.body.username || '').trim().toLowerCase(),
        password: req.body.password || '',
        confirmPassword: req.body.confirmPassword || '',
    };

    const errors = {};

    if (form.name.length < 2) {
        errors.name = 'Full name must be at least 2 characters.';
    }

    if (!EMAIL_REGEX.test(form.email)) {
        errors.email = 'Please enter a valid email address.';
    }

    if (!USERNAME_REGEX.test(form.username)) {
        errors.username =
            'Username must be 3-20 characters using letters, numbers or underscore.';
    }

    if (form.password.length < 8) {
        errors.password = 'Password must contain at least 8 characters.';
    }

    if (form.confirmPassword !== form.password) {
        errors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(errors).length > 0) {
        return renderRegister(req, res, errors, form);
    }

    try {
        const existingEmail = await User.findOne({ email: form.email });
        if (existingEmail) {
            errors.email = 'Email already registered.';
            return renderRegister(req, res, errors, form);
        }

        const existingUsername = await User.findOne({ username: form.username });
        if (existingUsername) {
            errors.username = 'Username already taken.';
            return renderRegister(req, res, errors, form);
        }

        const user = new User({
            name: form.name,
            email: form.email,
            username: form.username,
            password: form.password,
            role: 'user',
        });

        await user.save();

        req.session.user = user.toSafeObject();

        setFlash(req, 'success', 'Account created successfully. Welcome to CodeOrigin AI!');
        return res.redirect('/dashboard');
    } catch (error) {
        if (error && error.code === 11000) {
            const key = error.keyPattern && error.keyPattern.email
                ? 'email'
                : error.keyPattern && error.keyPattern.username
                    ? 'username'
                    : null;
            if (key) {
                errors[key] =
                    key === 'email' ? 'Email already registered.' : 'Username already taken.';
                return renderRegister(req, res, errors, form);
            }
        }

        console.error('Registration error:', error.message);
        errors.form =
            'Something went wrong while creating your account. Please try again.';
        return renderRegister(req, res, errors, form);
    }
};

exports.postLogin = async (req, res) => {
    const identifier = (req.body.identifier || '').trim().toLowerCase();
    const password = req.body.password || '';
    const nextUrl = req.body.next && !req.body.next.startsWith('/auth/')
        ? req.body.next
        : '';

    const form = { identifier, password: '' };

    if (!identifier || !password) {
        setFlash(req, 'error', 'Please enter your email/username and password.');
        return res.redirect('/auth/login');
    }

    try {
        const isEmail = identifier.includes('@');
        const query = isEmail
            ? { email: identifier }
            : { username: identifier };

        const user = await User.findOne(query);

        if (!user) {
            setFlash(req, 'error', 'Invalid email/username or password.');
            return res.redirect('/auth/login');
        }

        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            setFlash(req, 'error', 'Invalid email/username or password.');
            return res.redirect('/auth/login');
        }

        req.session.user = user.toSafeObject();

        const safeNext =
            typeof nextUrl === 'string' &&
            nextUrl.startsWith('/') &&
            !nextUrl.startsWith('//') &&
            !nextUrl.startsWith('/auth/');

        setFlash(req, 'success', `Welcome back, ${user.name.split(' ')[0]}!`);
        return res.redirect(safeNext ? nextUrl : '/dashboard');
    } catch (error) {
        console.error('Login error:', error.message);
        setFlash(req, 'error', 'Something went wrong. Please try again.');
        return res.redirect('/auth/login');
    }
};

exports.postLogout = (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error('Logout error:', error.message);
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid');
        return res.redirect('/auth/login?logged_out=1');
    });
};