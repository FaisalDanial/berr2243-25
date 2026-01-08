const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Simple approach - always load dotenv (it's okay if .env doesn't exist in Azure)
require('dotenv').config();

// Debug to see what environment variables are available
console.log('=== ENVIRONMENT VARIABLES ===');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'SET' : 'NOT SET');
console.log('PORT:', process.env.PORT || '3000 (default)');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'NOT SET');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('=============================');

const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "maxim_secret_key_123";
const SALT_ROUNDS = 10;

const app = express();
app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// ==================== ROOT ENDPOINT ====================
// Add this - Simple root endpoint to show API is running
app.get('/', (req, res) => {
    const now = new Date();
    const malaysiaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
    
    res.json({ 
        message: "🚀 Maxim Backend API is running successfully!",
        status: "active",
        mongodb: "connected",
        endpoints: {
            auth: {
                register_customer: "POST /api/auth/register/customer",
                register_driver: "POST /api/auth/register/driver",
                login: "POST /api/auth/login"
            },
            rides: {
                request: "POST /api/rides",
                cancel: "PATCH /api/rides/:id/cancel"
            },
            admin: {
                rates: "GET /api/admin/rates",
                users: "GET /api/admin/users"
            }
        },
        timestamp: malaysiaTime.toISOString(),
    });
});

let db;

// ==================== DATABASE INITIALIZATION ====================
async function connectToMongoDB() {
    const uri = process.env.MONGODB_URI || "mongodb+srv://FaisalDanial:JaiSoba02%40@benr2423.m9n3hhm.mongodb.net/maximDB?appName=BENR2423";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        db = client.db("maximDB");
        console.log("✅ Connected to MongoDB: maximDB");
        
        // 1. Ensure Unique Emails for ALL 3 Actors (Separate Collections)
        await db.collection('customers').createIndex({ email: 1 }, { unique: true });   // Customers
        await db.collection('drivers').createIndex({ email: 1 }, { unique: true });     // Drivers
        await db.collection('admins').createIndex({ email: 1 }, { unique: true });      // Admins
        
        // 2. Initialize Rates Collection
        const rates = await db.collection('rates').findOne({ type: 'standard' });
        if (!rates) {
            await db.collection('rates').insertOne({
                type: 'standard',
                baseFare: 5.00,
                perKm: 2.50,
                updatedAt: new Date(),
                updatedBy: 'system'
            });
            console.log("✅ Initialized Default Rate Configuration.");
        }

    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
    }
}
connectToMongoDB();

// Helper: Malaysia Time
function getMalaysiaTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
}

// ==================== MIDDLEWARE ====================

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Access token required" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid token" });
        req.user = user;
        next();
    });
};

// Enforce Admin Access
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: "Admin access required" });
    }
    next();
};

// ==================== 1. AUTHENTICATION (SEPARATE COLLECTIONS) ====================

// Register Customer (Saves to 'customers')
app.post('/api/auth/register/customer', async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        
        const result = await db.collection('customers').insertOne({
            email, passwordHash, name, phone,
            role: 'customer', isBlocked: false, createdAt: getMalaysiaTime()
        });
        res.status(201).json({ message: "Customer created", userId: result.insertedId });
    } catch (err) { res.status(409).json({ error: "Email already exists" }); }
});

// Register Driver (Saves to 'drivers')
app.post('/api/auth/register/driver', async (req, res) => {
    try {
        const { email, password, name, vehicleDetails } = req.body;
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        
        const result = await db.collection('drivers').insertOne({
            email, passwordHash, name, vehicleDetails,
            role: 'driver', availabilityStatus: 'offline', isBlocked: false,
            walletBalance: 0.00, createdAt: getMalaysiaTime()
        });
        res.status(201).json({ message: "Driver created", driverId: result.insertedId });
    } catch (err) { res.status(409).json({ error: "Email already exists" }); }
});

// Register Admin (Saves to 'admins')
app.post('/api/auth/register/admin', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        
        const result = await db.collection('admins').insertOne({
            email, passwordHash, name, role: 'admin', isBlocked: false, createdAt: getMalaysiaTime()
        });
        res.status(201).json({ message: "Admin created", adminId: result.insertedId });
    } catch (err) { res.status(400).json({ error: "Error creating admin" }); }
});

// Unified Login (Checks ALL 3 Collections)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        let user = null;

        // 1. Check Customers
        user = await db.collection('customers').findOne({ email });

        // 2. Check Drivers
        if (!user) user = await db.collection('drivers').findOne({ email });

        // 3. Check Admins
        if (!user) user = await db.collection('admins').findOne({ email });

        // Validate
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        
        if (user.isBlocked) return res.status(403).json({ error: "Account is blocked by Admin." });

        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role }, 
            JWT_SECRET, { expiresIn: '2h' }
        );

        res.json({ message: `Login successful as ${user.role}`, token, role: user.role, userId: user._id });
    } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ==================== RELATIONSHIP 1: CUSTOMER ↔️ RIDE ====================

app.post('/api/rides', authenticateToken, async (req, res) => {
    if (req.user.role !== 'customer') return res.status(403).json({ error: "Only customers can book" });

    const { pickupLocation, dropoffLocation, distanceKm } = req.body;
    if (!pickupLocation || !dropoffLocation) return res.status(400).json({ error: "Missing location data" });

    const rate = await db.collection('rates').findOne({ type: 'standard' });
    const dist = distanceKm || 5; 
    const estFare = (rate.baseFare + (rate.perKm * dist));

    const rideData = {
        customerId: new ObjectId(req.user.id),
        pickupLocation, dropoffLocation, distanceKm: dist,
        status: 'requested',
        estimatedFare: parseFloat(estFare.toFixed(2)),
        driverId: null,
        createdAt: getMalaysiaTime()
    };

    const result = await db.collection('rides').insertOne(rideData);
    res.status(201).json({ message: "Ride requested", rideId: result.insertedId, fare: rideData.estimatedFare });
});

app.patch('/api/rides/:id/cancel', authenticateToken, async (req, res) => {
    const result = await db.collection('rides').updateOne(
        { _id: new ObjectId(req.params.id), customerId: new ObjectId(req.user.id), status: 'requested' },
        { $set: { status: 'cancelled', cancelledAt: getMalaysiaTime() } }
    );
    if (result.modifiedCount === 0) return res.status(409).json({ error: "Cannot cancel: Ride started or not found." });
    res.json({ message: "Ride cancelled" });
});

// ==================== RELATIONSHIP 2: DRIVER ↔️ RIDE ====================

// 1. Driver Status Management
app.patch('/api/drivers/status', authenticateToken, async (req, res) => {
    if (req.user.role !== 'driver') return res.status(403).json({ error: "Not a driver" });
    const { status } = req.body; 

    if (status === 'online') {
        const driver = await db.collection('drivers').findOne({ _id: new ObjectId(req.user.id) });
        if (!driver.vehicleDetails) return res.status(400).json({ error: "Register vehicle first." });
    }

    await db.collection('drivers').updateOne(
        { _id: new ObjectId(req.user.id) },
        { $set: { availabilityStatus: status } }
    );
    res.json({ message: `Status updated to ${status}` });
});

// 2. View Available Rides
app.get('/api/rides/available', authenticateToken, async (req, res) => {
    if (req.user.role !== 'driver') return res.status(403).json({ error: "Not a driver" });

    const driver = await db.collection('drivers').findOne({ _id: new ObjectId(req.user.id) });
    if (driver.availabilityStatus !== 'online') return res.status(403).json({ error: "You are offline." });

    const rides = await db.collection('rides').find({ status: 'requested' }).toArray();
    res.json(rides);
});

// 3. Accept Ride
app.patch('/api/rides/:id/accept', authenticateToken, async (req, res) => {
    if (req.user.role !== 'driver') return res.status(403).json({ error: "Not a driver" });

    const result = await db.collection('rides').updateOne(
        { _id: new ObjectId(req.params.id), status: 'requested' }, 
        { 
            $set: { 
                status: 'accepted', 
                driverId: new ObjectId(req.user.id),
                acceptedAt: getMalaysiaTime() 
            } 
        }
    );

    if (result.modifiedCount === 0) return res.status(409).json({ error: "Ride already taken." });
    res.json({ message: "Ride accepted" });
});

// 4. Complete Ride (UPDATED WITH WALLET FIX)
app.patch('/api/rides/:id/complete', authenticateToken, async (req, res) => {
    if (req.user.role !== 'driver') return res.status(403).json({ error: "Not a driver" });

    // 1. Fetch Ride First to get the fare
    const ride = await db.collection('rides').findOne({ 
        _id: new ObjectId(req.params.id), 
        driverId: new ObjectId(req.user.id) 
    });

    if (!ride) return res.status(404).json({ error: "Ride not found or not yours" });

    // 2. Mark as Completed
    await db.collection('rides').updateOne(
        { _id: new ObjectId(req.params.id) },
        { 
            $set: { 
                status: 'completed', 
                completedAt: getMalaysiaTime(),
                finalFare: ride.estimatedFare 
            } 
        }
    );

    // 3. Add Money to Driver's Wallet ($inc)
    await db.collection('drivers').updateOne(
        { _id: new ObjectId(req.user.id) },
        { $inc: { walletBalance: ride.estimatedFare } }
    );

    res.json({ message: "Ride completed", earned: ride.estimatedFare });
});

// ==================== RELATIONSHIP 3: ADMIN ↔️ RATE ====================

app.post('/api/admin/rates', authenticateToken, isAdmin, async (req, res) => {
    const { baseFare, perKm } = req.body;
    await db.collection('rates').updateOne(
        { type: 'standard' },
        { $set: { baseFare, perKm, updatedBy: req.user.email, updatedAt: getMalaysiaTime() } },
        { upsert: true }
    );
    res.json({ message: "Global rates updated" });
});

app.get('/api/admin/rates', authenticateToken, isAdmin, async (req, res) => {
    const rates = await db.collection('rates').findOne({ type: 'standard' });
    res.json(rates);
});

// ==================== RELATIONSHIP 4 & 5: ADMIN ↔️ USER/DRIVER ====================

// View All Users
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    const customers = await db.collection('customers').find().toArray();
    const drivers = await db.collection('drivers').find().toArray();
    const admins = await db.collection('admins').find().toArray();
    res.json({ 
        counts: { customers: customers.length, drivers: drivers.length, admins: admins.length },
        customers, drivers, admins
    });
});

// Block/Unblock
app.patch('/api/admin/users/:id/block', authenticateToken, isAdmin, async (req, res) => {
    const { isBlocked } = req.body;
    
    let result = await db.collection('customers').updateOne(
        { _id: new ObjectId(req.params.id) }, { $set: { isBlocked } }
    );

    if (result.matchedCount === 0) {
        result = await db.collection('drivers').updateOne(
            { _id: new ObjectId(req.params.id) }, { $set: { isBlocked } }
        );
    }
    
    if (result.matchedCount === 0) {
         result = await db.collection('admins').updateOne(
            { _id: new ObjectId(req.params.id) }, { $set: { isBlocked } }
        );
    }

    if (result.matchedCount === 0) return res.status(404).json({ error: "Customer/Driver/Admin not found" });
    res.json({ message: `Block status updated to ${isBlocked}` });
});

// Delete User
app.delete('/api/admin/users/:id', authenticateToken, isAdmin, async (req, res) => {
    let result = await db.collection('customers').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
        result = await db.collection('drivers').deleteOne({ _id: new ObjectId(req.params.id) });
    }
    
    if (result.deletedCount === 0) {
        result = await db.collection('admins').deleteOne({ _id: new ObjectId(req.params.id) });
    }
    
    if (result.deletedCount === 0) return res.status(404).json({ error: "User not found" });
    res.status(204).send();
});

// ==================== SERVER START ====================
app.listen(port, () => {
    console.log(`🚀 Maxim App Server running on port ${port}`);
});

//done