const express = require('express');
const path = require('path');
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const { connectDB } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const analysisRoutes = require('./routes/analysisRoutes');
const { requireAuth } = require('./middleware/authMiddleware');

const app = express();
const port = process.env.PORT || 3000;

// View engine + static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'codeorigin-dev-insecure-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: process.env.SESSION_MAX_AGE
                ? parseInt(process.env.SESSION_MAX_AGE, 10)
                : 1000 * 60 * 60 * 24,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        },
    })
);

// Global auth state for every EJS view
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.path = req.path;

    // One-shot flash message (session flash-style)
    if (req.session.flash) {
        res.locals.flashMsg = req.session.flash;
        delete req.session.flash;
    } else {
        res.locals.flashMsg = null;
    }

    next();
});

// =========================================================
// PUBLIC ROUTES
// =========================================================

app.get('/', (req, res) => {
    res.render('dashboard/index', { pageTitle: 'CodeOrigin AI | Repository Intelligence' });
});

// =========================================================
// AUTH ROUTES
// =========================================================

app.use('/auth', authRoutes);
app.use('/', analysisRoutes);

// =========================================================
// PROTECTED ROUTES
// =========================================================

app.get('/dashboard', requireAuth, (req, res) => {
    res.render('dashboard/index', { pageTitle: 'Dashboard | CodeOrigin AI' });
});

app.get('/analyze', requireAuth, (req, res) => {
    res.render('repository/analyze');
});

app.get('/reports', requireAuth, (req, res) => {
    res.render('reports/report');
});

app.get('/report', requireAuth, (req, res) => {
    res.render('reports/report');
});

app.get('/about' , (req , res) => {
   res.render('about');
});

// =========================================================
// START SERVER
// =========================================================

const startServer = async () => {
    const databaseConnected = await connectDB();

    if (!databaseConnected) {
        console.warn(
            'Starting the web server without MongoDB; database-backed auth actions will be temporarily unavailable.'
        );
    }

    app.listen(port, () => {
        console.log(`CodeOrigin AI listening on port ${port}`);
        console.log(` → http://localhost:${port}`);
    });
};

startServer().catch((error) => {
    console.error('CodeOrigin AI failed to start:', error.message);
    process.exitCode = 1;
});