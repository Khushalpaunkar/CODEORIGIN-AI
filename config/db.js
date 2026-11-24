const mongoose = require('mongoose');

mongoose.connection.on('connected', () => {
    console.log('MongoDB connected successfully.');
});

mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB connection lost.');
});

const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI;

        if (!uri) {
            console.error('MongoDB connection failed: MONGODB_URI is not defined.');
            return false;
        }

        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 10000,
        });

        return true;
    } catch (error) {
        console.error(
            `MongoDB connection failed (${error.name || 'unknown error'}). Check MONGODB_URI and network access.`
        );
        return false;
    }
};

const isDatabaseConnected = () => mongoose.connection.readyState === 1;

module.exports = { connectDB, isDatabaseConnected };