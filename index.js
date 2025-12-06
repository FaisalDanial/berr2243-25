const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt'); // Added: For password hashing
const jwt = require('jsonwebtoken'); // Added: For issuing authentication tokens
const saltRounds = 10;
const port = 3000;
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

const app = express();
app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

let db;

async function connectToMongoDB() {
    // NOTE: This assumes a local MongoDB instance. Use an external URI for production.
    const uri = "mongodb://127.0.0.1:27017"; 
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("Connected to MongoDB!");
        db = client.db("maximDB");
        
        // ADDED: Debug logging to see what's happening
        console.log("Using database: maximDB");
        
        // List collections
        const collections = await db.listCollections().toArray();
        console.log("Available collections:", collections.map(c => c.name));
        
        // Count documents
        const usersCount = await db.collection('users').countDocuments();
        const driversCount = await db.collection('drivers').countDocuments();
        const ridesCount = await db.collection('rides').countDocuments();
        
        console.log(`Users count: ${usersCount}`);
        console.log(`Drivers count: ${driversCount}`);
        console.log(`Rides count: ${ridesCount}`);
        
        // Ensure email is unique for both users and drivers collections
        await db.collection('users').createIndex({ email: 1 }, { unique: true });
        await db.collection('drivers').createIndex({ email: 1 }, { unique: true });

    } catch (err) {
        console.error("Error connecting to MongoDB:", err);
    }
}

connectToMongoDB();

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Helper function to get Malaysia Time (UTC+8)
function getMalaysiaTime() {
    const now = new Date();
    // Use toISOString() in the front-end to format
    return new Date(now.getTime() + (8 * 60 * 60 * 1000));
}

// Helper function to format Malaysia Time for response
function formatMalaysiaTime(date) {
    if (!date) return null;
    return date.toISOString().replace('.000Z', '+08:00'); // Simple custom format to indicate UTC+8
}

// ==================== AUTHENTICATION MIDDLEWARE (UPDATED) ====================

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: "Access token required" });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Invalid or expired token" });
        }
        req.user = user;
        next();
    });
};

// Enhanced Admin Middleware
const isAdmin = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        // Check if user exists and is admin
        const user = await db.collection('users').findOne({ 
            _id: new ObjectId(req.user.id), 
            role: 'admin' 
        });

        if (!user) {
            return res.status(403).json({ error: "Admin access required" });
        }

        req.admin = user;
        next();
    } catch (err) {
        return res.status(403).json({ error: "Admin verification failed" });
    }
};

// ==================== DEBUG ENDPOINTS (NEW) ====================

// Debug endpoint to check database status
app.get('/api/debug/db-status', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({ error: "Database not connected" });
        }
        
        const users = await db.collection('users').find().toArray();
        const drivers = await db.collection('drivers').find().toArray();
        const rides = await db.collection('rides').find().toArray();
        
        res.json({
            database: "maximDB",
            connection: "OK",
            usersCount: users.length,
            driversCount: drivers.length, 
            ridesCount: rides.length,
            users: users.map(u => ({ _id: u._id, email: u.email, name: u.name, role: u.role })),
            drivers: drivers.map(d => ({ _id: d._id, email: d.email, name: d.name })),
            rides: rides.map(r => ({ _id: r._id, status: r.status, customerId: r.customerId, driverId: r.driverId }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== AUTHENTICATION ENDPOINTS (NEW/UPDATED) ====================

// 0. POST /api/users - Customer Registration (UPDATED with HASHING)
app.post('/api/users', async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;
        if (!email || !password || !name) {
            return res.status(400).json({ error: "Missing required fields (email, password, name)" });
        }

        // 1. Check if user already exists (by email)
        const existingUser = await db.collection('users').findOne({ email });
        if (existingUser) {
            return res.status(409).json({ error: "User with this email already exists" });
        }

        // 2. Hash the password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        const malaysiaTime = getMalaysiaTime();
        
        const userData = {
            email,
            passwordHash, // Store the hash, NOT the plain password
            name,
            phone: phone || null,
            role: 'customer', // Default role
            isBlocked: false,
            createdAt: malaysiaTime,
            updatedAt: malaysiaTime
        };
        
        const result = await db.collection('users').insertOne(userData);
        
        // ADDED: Verify the data was saved
        const savedUser = await db.collection('users').findOne({_id: result.insertedId});
        console.log("User saved to MongoDB:", savedUser ? "YES" : "NO");
        
        // Exclude passwordHash from the response
        res.status(201).json({ 
            message: "Customer created successfully",
            userId: result.insertedId,
            email: email,
            createdAt: formatMalaysiaTime(malaysiaTime)
        });
    } catch (err) {
        // Handle MongoDB unique index violation (email conflict)
        if (err.code === 11000) {
             return res.status(409).json({ error: "User with this email already exists." });
        }
        res.status(400).json({ error: "Invalid user data or registration failed" });
    }
});

// 0. POST /api/auth/login - Customer/Driver Login (NEW: Required for Lab Exercise)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        // Find user in both 'users' and 'drivers' collections (or combine them later)
        let user = await db.collection('users').findOne({ email });
        let role = 'customer';
        let collection = 'users';

        if (!user) {
            // Check in drivers collection if not found in users
            user = await db.collection('drivers').findOne({ email });
            role = 'driver';
            collection = 'drivers';
        }

        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" }); // Use 401 Unauthorized
        }

        // Check password
        const passwordMatch = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid credentials" }); // Use 401 Unauthorized
        }

        // Successful login: Generate JWT Token
        const token = jwt.sign(
            { id: user._id, email: user.email, role: role }, 
            JWT_SECRET, 
            { expiresIn: '1h' }
        );

        // Success response
        res.status(200).json({ 
            message: `${role} logged in successfully`,
            token: token,
            role: role,
            userId: user._id
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "An internal server error occurred during login" });
    }
});

// 0. POST /api/drivers - Create Driver (UPDATED with HASHING)
app.post('/api/drivers', async (req, res) => {
    try {
        const { email, password, name, vehicleDetails } = req.body;
        if (!email || !password || !name || !vehicleDetails) {
            return res.status(400).json({ error: "Missing required fields (email, password, name, vehicleDetails)" });
        }

        // 1. Check if driver already exists (by email)
        const existingDriver = await db.collection('drivers').findOne({ email });
        if (existingDriver) {
            return res.status(409).json({ error: "Driver with this email already exists" });
        }

        // 2. Hash the password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const malaysiaTime = getMalaysiaTime();
        
        const driverData = {
            email,
            passwordHash,
            name,
            vehicleDetails,
            role: 'driver',
            availabilityStatus: 'offline', // Initial status
            isBlocked: false,
            createdAt: malaysiaTime,
            updatedAt: malaysiaTime
        };
        
        const result = await db.collection('drivers').insertOne(driverData);
        
        // ADDED: Verify the data was saved
        const savedDriver = await db.collection('drivers').findOne({_id: result.insertedId});
        console.log("Driver saved to MongoDB:", savedDriver ? "YES" : "NO");
        
        res.status(201).json({ 
            message: "Driver created successfully",
            driverId: result.insertedId,
            email: email,
            createdAt: formatMalaysiaTime(malaysiaTime)
        });
    } catch (err) {
         if (err.code === 11000) {
             return res.status(409).json({ error: "Driver with this email already exists." });
        }
        res.status(400).json({ error: "Invalid driver data or registration failed" });
    }
});

// ==================== ADMIN AUTHENTICATION ENDPOINTS (NEW) ====================

// Admin Registration
app.post('/api/admin/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) {
            return res.status(400).json({ error: "Missing required fields (email, password, name)" });
        }

        // Check if admin already exists
        const existingAdmin = await db.collection('users').findOne({ email, role: 'admin' });
        if (existingAdmin) {
            return res.status(409).json({ error: "Admin with this email already exists" });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        const malaysiaTime = getMalaysiaTime();
        
        const adminData = {
            email,
            passwordHash,
            name,
            role: 'admin',
            isBlocked: false,
            createdAt: malaysiaTime,
            updatedAt: malaysiaTime
        };
        
        const result = await db.collection('users').insertOne(adminData);
        
        // ADDED: Verify the data was saved
        const savedAdmin = await db.collection('users').findOne({_id: result.insertedId});
        console.log("Admin saved to MongoDB:", savedAdmin ? "YES" : "NO");
        
        res.status(201).json({ 
            message: "Admin created successfully",
            adminId: result.insertedId,
            email: email
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: "User with this email already exists" });
        }
        res.status(400).json({ error: "Invalid admin data" });
    }
});

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        // Find admin user
        const admin = await db.collection('users').findOne({ 
            email, 
            role: 'admin' 
        });

        if (!admin) {
            return res.status(401).json({ error: "Invalid admin credentials" });
        }

        // Check password
        const passwordMatch = await bcrypt.compare(password, admin.passwordHash);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid admin credentials" });
        }

        // Generate JWT Token
        const token = jwt.sign(
            { id: admin._id, email: admin.email, role: 'admin' }, 
            JWT_SECRET, 
            { expiresIn: '1h' }
        );

        res.status(200).json({ 
            message: "Admin logged in successfully",
            token: token,
            role: 'admin',
            adminId: admin._id
        });
    } catch (err) {
        console.error("Admin login error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ==================== PHASE 1: CUSTOMER APIs (RIDES) ====================

// 1. POST /api/rides - Customer: Request Ride
// NOTE: In a real app, this should require authentication via JWT.
app.post('/api/rides', async (req, res) => {
    try {
        const malaysiaTime = getMalaysiaTime();
        
        // Basic validation for required fields (e.g., customerId, pickup, dropoff)
        const { customerId, pickupLocation, dropoffLocation, paymentMethod } = req.body;
        if (!customerId || !pickupLocation || !dropoffLocation) {
             return res.status(400).json({ error: "Missing required ride details (customerId, pickup, dropoff)" });
        }
        
        const rideData = {
            ...req.body,
            customerId: new ObjectId(customerId), // Ensure ID is saved as ObjectId
            status: 'requested',
            createdAt: malaysiaTime,
            updatedAt: malaysiaTime,
            cancelledAt: null,
            acceptedAt: null,
            completedAt: null,
            driverId: null, // Driver assigned later
            fare: null, // Calculated/assigned later
        };
        
        const result = await db.collection('rides').insertOne(rideData);
        
        // ADDED: Verify the data was saved
        const savedRide = await db.collection('rides').findOne({_id: result.insertedId});
        console.log("Ride saved to MongoDB:", savedRide ? "YES" : "NO");
        
        res.status(201).json({ 
            message: "Ride requested successfully",
            rideId: result.insertedId,
            createdAt: formatMalaysiaTime(malaysiaTime)
        });
    } catch (err) {
        console.error("Ride request error:", err);
        res.status(400).json({ error: "Invalid ride data" });
    }
});

// 2. GET /api/rides/:id - Customer: View Ride Details
app.get('/api/rides/:id', async (req, res) => {
    try {
        const ride = await db.collection('rides').findOne(
            { _id: new ObjectId(req.params.id) }
        );

        if (!ride) {
            return res.status(404).json({ error: "Ride not found" });
        }
        
        // Format dates for display
        const rideWithMalaysiaTime = {
            ...ride,
            customerId: ride.customerId.toString(),
            driverId: ride.driverId ? ride.driverId.toString() : null,
            createdAt: formatMalaysiaTime(ride.createdAt),
            updatedAt: formatMalaysiaTime(ride.updatedAt),
            cancelledAt: ride.cancelledAt ? formatMalaysiaTime(ride.cancelledAt) : null,
            acceptedAt: ride.acceptedAt ? formatMalaysiaTime(ride.acceptedAt) : null,
            scheduledOrder: ride.scheduledOrder ? formatMalaysiaTime(ride.scheduledOrder) : null
        };
        
        res.status(200).json(rideWithMalaysiaTime);
    } catch (err) {
        res.status(400).json({ error: "Invalid ride ID" });
    }
});

// 3. PATCH /api/rides/:id/cancel - Customer: Cancel Ride
app.patch('/api/rides/:id/cancel', async (req, res) => {
    try {
        const malaysiaTime = getMalaysiaTime();
        
        const ride = await db.collection('rides').findOne(
            { _id: new ObjectId(req.params.id) }
        );

        if (!ride) {
            return res.status(404).json({ error: "Ride not found" });
        }

        // Allow cancellation if status is 'requested' (before acceptance)
        if (ride.status === 'accepted' || ride.status === 'started' || ride.status === 'completed') {
            // Note: Use 403 Forbidden if they are not the owner, but 409 Conflict if status prohibits it
            return res.status(409).json({ error: `Cannot cancel ride in status: ${ride.status}.` });
        }
        
        if (ride.status === 'cancelled') {
             return res.status(409).json({ error: "Ride is already cancelled." });
        }

        const result = await db.collection('rides').updateOne(
            { _id: new ObjectId(req.params.id) },
            { 
                $set: { 
                    status: 'cancelled',
                    cancelledAt: malaysiaTime,
                    updatedAt: malaysiaTime
                } 
            }
        );

        res.status(200).json({ 
            message: "Ride cancelled successfully",
            cancelledAt: formatMalaysiaTime(malaysiaTime)
        });
    } catch (err) {
        res.status(400).json({ error: "Invalid ride ID" });
    }
});

// 4. POST /api/rides/:id/review - Customer: Give Review
// NOTE: Endpoint simplified from the spec /drivers/{id}/ratings to use the ride ID for easier lookup
app.post('/api/rides/:id/review', async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const malaysiaTime = getMalaysiaTime();
        
        if (typeof rating !== 'number' || rating < 1 || rating > 5) {
            return res.status(400).json({ error: "Rating must be a number between 1-5" });
        }

        const ride = await db.collection('rides').findOne(
            { _id: new ObjectId(req.params.id) }
        );

        if (!ride) {
            return res.status(404).json({ error: "Ride not found" });
        }

        if (ride.status !== 'completed') {
            return res.status(409).json({ error: "Can only review completed rides" });
        }
        
        if (ride.review) {
            return res.status(409).json({ error: "Ride has already been reviewed" });
        }

        const result = await db.collection('rides').updateOne(
            { _id: new ObjectId(req.params.id) },
            { 
                $set: { 
                    review: { 
                        rating, 
                        comment: comment || "", // Allow empty comment
                        reviewedAt: malaysiaTime 
                    },
                    updatedAt: malaysiaTime
                } 
            }
        );

        res.status(201).json({ 
            message: "Review submitted successfully",
            reviewedAt: formatMalaysiaTime(malaysiaTime)
        });
    } catch (err) {
        res.status(400).json({ error: "Invalid ride ID or review data" });
    }
});

// ==================== PHASE 2: DRIVER APIs (DRIVERS) ====================

// 5. GET /api/rides/available - Driver: View Available Orders
app.get('/api/rides/available', async (req, res) => {
    try {
        const rides = await db.collection('rides').find({ 
            status: 'requested' 
        }).toArray();
        
        const ridesWithMalaysiaTime = rides.map(ride => ({
            ...ride,
            createdAt: formatMalaysiaTime(ride.createdAt),
            updatedAt: formatMalaysiaTime(ride.updatedAt),
            // Mask sensitive data for public viewing if necessary, but returning full data for driver is acceptable
        }));
        
        res.status(200).json(ridesWithMalaysiaTime);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch available rides" });
    }
});

// 6. GET /api/users/:id - Driver: View Customer Profile (or vice versa)
app.get('/api/users/:id', async (req, res) => {
    try {
        // Search in both collections for maximum flexibility, but prefer 'users' (customers)
        let user = await db.collection('users').findOne(
            { _id: new ObjectId(req.params.id) }
        );

        if (!user) {
             user = await db.collection('drivers').findOne(
                { _id: new ObjectId(req.params.id) }
            );
        }

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        
        // Remove sensitive data (password hash)
        const { passwordHash, ...safeUser } = user;
        const userWithMalaysiaTime = {
            ...safeUser,
            createdAt: formatMalaysiaTime(user.createdAt),
            updatedAt: formatMalaysiaTime(user.updatedAt)
        };
        
        res.status(200).json(userWithMalaysiaTime);
    } catch (err) {
        res.status(400).json({ error: "Invalid user ID" });
    }
});

// 7. GET /api/rides/:id/payment - Driver: View Payment
// NOTE: Payment data is mocked for simplicity but demonstrates the endpoint's purpose.
app.get('/api/rides/:id/payment', async (req, res) => {
    try {
        const ride = await db.collection('rides').findOne(
            { _id: new ObjectId(req.params.id) }
        );

        if (!ride) {
            return res.status(404).json({ error: "Ride not found" });
        }
        
        // This is a simple mockup of payment data structure.
        const totalFare = ride.fare || 20.70; // Use actual fare if available, otherwise mock
        const paymentDetails = {
            rideId: ride._id,
            totalFare: totalFare,
            paymentMethod: ride.paymentMethod || 'Cash',
            paymentStatus: ride.status === 'completed' ? 'completed' : 'pending',
            currency: 'MYR'
        };
        
        res.status(200).json(paymentDetails);
    } catch (err) {
        res.status(400).json({ error: "Invalid ride ID" });
    }
});

// 8. PATCH /api/rides/:id/accept - Driver: Accept Order
app.patch('/api/rides/:id/accept', async (req, res) => {
    try {
        const { driverId } = req.body;
        const malaysiaTime = getMalaysiaTime();
        
        if (!driverId || !ObjectId.isValid(driverId)) {
            return res.status(400).json({ error: "Valid Driver ID is required" });
        }

        const ride = await db.collection('rides').findOne(
            { _id: new ObjectId(req.params.id) }
        );

        if (!ride) {
            return res.status(404).json({ error: "Ride not found" });
        }

        if (ride.status !== 'requested') {
            return res.status(409).json({ error: `Ride is in status '${ride.status}' and cannot be accepted.` });
        }

        // Use atomic update to prevent two drivers accepting the same ride
        const result = await db.collection('rides').updateOne(
            { 
                _id: new ObjectId(req.params.id),
                status: 'requested' // Only accept if still in requested state
            },
            { 
                $set: { 
                    status: 'accepted',
                    driverId: new ObjectId(driverId),
                    acceptedAt: malaysiaTime,
                    updatedAt: malaysiaTime
                } 
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(409).json({ error: "Ride already accepted by another driver or status changed." });
        }
        
        res.status(200).json({ 
            message: "Ride accepted successfully",
            acceptedAt: formatMalaysiaTime(malaysiaTime)
        });
    } catch (err) {
        res.status(400).json({ error: "Invalid ride ID or driver ID" });
    }
});

// 8b. PATCH /api/rides/:id/complete - Driver: Complete Ride (Added for completeness)
app.patch('/api/rides/:id/complete', async (req, res) => {
    try {
        const malaysiaTime = getMalaysiaTime();
        
        const ride = await db.collection('rides').findOne(
            { _id: new ObjectId(req.params.id) }
        );

        if (!ride) {
            return res.status(404).json({ error: "Ride not found" });
        }

        if (ride.status !== 'accepted' && ride.status !== 'started') {
            return res.status(409).json({ error: `Ride status must be 'accepted' or 'started' to complete. Current status: ${ride.status}` });
        }

        const result = await db.collection('rides').updateOne(
            { _id: new ObjectId(req.params.id) },
            { 
                $set: { 
                    status: 'completed',
                    completedAt: malaysiaTime,
                    updatedAt: malaysiaTime,
                    fare: req.body.finalFare || ride.fare || 25.00 // Finalize fare
                } 
            }
        );
        
        res.status(200).json({ 
            message: "Ride completed successfully",
            completedAt: formatMalaysiaTime(malaysiaTime),
            finalFare: req.body.finalFare || 25.00
        });
    } catch (err) {
        res.status(400).json({ error: "Invalid ride ID or data" });
    }
});

// ==================== PHASE 3: ADMIN APIs (ADMIN) ====================
// NOTE: All Admin routes should be protected by the isAdmin middleware in a production environment.

// 9. GET /api/admin/rides - Admin: View All Rides
app.get('/api/admin/rides', authenticateToken, isAdmin, async (req, res) => {
    try {
        const rides = await db.collection('rides').find().toArray();
        
        const ridesWithMalaysiaTime = rides.map(ride => ({
            ...ride,
            customerId: ride.customerId.toString(),
            driverId: ride.driverId ? ride.driverId.toString() : null,
            createdAt: formatMalaysiaTime(ride.createdAt),
            updatedAt: formatMalaysiaTime(ride.updatedAt),
            cancelledAt: ride.cancelledAt ? formatMalaysiaTime(ride.cancelledAt) : null,
            acceptedAt: ride.acceptedAt ? formatMalaysiaTime(ride.acceptedAt) : null
        }));
        
        res.status(200).json(ridesWithMalaysiaTime);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch rides" });
    }
});

// 10. PATCH /api/admin/users/:id - Admin: Manage Users (e.g., Block)
app.patch('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const malaysiaTime = getMalaysiaTime();
        const updateFields = { ...req.body, updatedAt: malaysiaTime };
        
        // Find if user exists in users collection
        let result = await db.collection('users').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updateFields }
        );

        if (result.modifiedCount === 0) {
            // Check in drivers collection
            result = await db.collection('drivers').updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: updateFields }
            );
        }

        if (result.modifiedCount === 0 && result.matchedCount === 0) {
            return res.status(404).json({ error: "User or Driver not found" });
        }
        
        res.status(200).json({ 
            message: "User/Driver updated successfully",
            updatedAt: formatMalaysiaTime(malaysiaTime)
        });
    } catch (err) {
        res.status(400).json({ error: "Invalid ID or data" });
    }
});

// 11. DELETE /api/admin/users/:id - Admin: Remove User/Driver
app.delete('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        let result = await db.collection('users').deleteOne(
            { _id: new ObjectId(req.params.id) }
        );

        if (result.deletedCount === 0) {
            // Check in drivers collection
            result = await db.collection('drivers').deleteOne(
                { _id: new ObjectId(req.params.id) }
            );
        }

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "User/Driver not found" });
        }
        
        // Use 204 No Content for a successful DELETE
        res.status(204).send(); 
    } catch (err) {
        res.status(400).json({ error: "Invalid user ID" });
    }
});

// 12. DELETE /api/admin/reviews/:id - Admin: Remove Review
app.delete('/api/admin/reviews/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const malaysiaTime = getMalaysiaTime();
        
        // Assume the ID is the Ride ID which contains the review
        const result = await db.collection('rides').updateOne(
            { _id: new ObjectId(req.params.id) },
            { 
                $unset: { review: "" }, // Remove the entire review sub-document
                $set: { updatedAt: malaysiaTime }
            }
        );

        if (result.modifiedCount === 0) {
            // Check if the ride exists but didn't have a review (404/204 semantics)
            const ride = await db.collection('rides').findOne({ _id: new ObjectId(req.params.id) });
            if (!ride) {
                 return res.status(404).json({ error: "Ride not found" });
            }
            // If ride found but no review unset, treat as success (nothing to delete)
            return res.status(204).send();
        }
        
        res.status(204).send(); // Successful deletion
    } catch (err) {
        res.status(400).json({ error: "Invalid ride ID" });
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: "Maxim Ride-Hailing API is running!",
        timestamp: formatMalaysiaTime(getMalaysiaTime())
    });
});

console.log("Server updated with debug endpoints and enhanced authentication!");