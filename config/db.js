const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI;

        if (!uri) {
            console.error('MONGODB_URI is not defined in .env');
            return false;
        }

        const conn = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 10000,
        });

        console.log(`MongoDB connected successfully (${conn.connection.host})`);
        return true;
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        console.error('Update MONGODB_URI with the current Atlas database user credentials, then restart the server.');
        return false;
    }
};

module.exports = connectDB;