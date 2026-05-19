const express = require('express');
const cors = require('cors');
const fs = require('fs');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = './data.json';
const ORDERS_FILE = './orders.json';

// Track processed operations to prevent duplicates
const processedOperations = new Map(); // Store with timestamps

function isOperationProcessed(key, ttl = 10000) {
    if (processedOperations.has(key)) {
        const timestamp = processedOperations.get(key);
        if (Date.now() - timestamp < ttl) {
            return true;
        }
        processedOperations.delete(key);
    }
    return false;
}

function markOperationProcessed(key) {
    processedOperations.set(key, Date.now());
    // Auto cleanup after TTL
    setTimeout(() => {
        if (processedOperations.get(key) === Date.now() - 10000) {
            processedOperations.delete(key);
        }
    }, 10000);
}

// ============ RAZORPAY INITIALIZATION ============
const RAZORPAY_KEY_ID = 'rzp_test_SqTRTOBs6qninO';
const RAZORPAY_KEY_SECRET = 'TOqeBfLRRuZ2qrG6YrgnKByK';

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

// Helper functions
const readJSON = (filePath, defaultValue = null) => {
    if (!fs.existsSync(filePath)) {
        if (defaultValue !== null) {
            fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
        }
        return defaultValue;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`Error reading ${filePath}:`, e);
        return defaultValue;
    }
};

const writeJSON = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// Initialize data.json
const initDataFile = () => {
    let data = readJSON(DATA_FILE, null);
    
    if (!data || Array.isArray(data)) {
        data = {
            products: [
                { id: 1, name: "Banarasi Silk Saree", price: 2500, stock: 50, category: "Silk", description: "Pure Banarasi silk saree with heavy zari work. Perfect for weddings.", image: "https://via.placeholder.com/150", images: ["https://via.placeholder.com/150"] },
                { id: 2, name: "Cotton Saree", price: 1200, stock: 100, category: "Cotton", description: "Comfortable cotton saree for daily wear. Easy to maintain.", image: "https://via.placeholder.com/150", images: ["https://via.placeholder.com/150"] },
                { id: 3, name: "Kanchipuram Saree", price: 3500, stock: 30, category: "Silk", description: "Authentic Kanchipuram silk saree with traditional designs.", image: "https://via.placeholder.com/150", images: ["https://via.placeholder.com/150"] }
            ],
            users: [
                { id: 1, username: "admin", password: "123", phone: "9999999999", status: "Verified", registeredAt: new Date().toISOString() }
            ]
        };
        writeJSON(DATA_FILE, data);
    }
    
    if (!data.users) data.users = [];
    if (!data.products) data.products = [];
    writeJSON(DATA_FILE, data);
};

// Initialize orders.json
const initOrdersFile = () => {
    if (!fs.existsSync(ORDERS_FILE)) {
        writeJSON(ORDERS_FILE, []);
    }
};

initDataFile();
initOrdersFile();

// ============ USER ROUTES ============

app.get('/users', (req, res) => {
    const data = readJSON(DATA_FILE, { products: [], users: [] });
    res.json(data.users || []);
});

app.post('/users', (req, res) => {
    const { username, password, phone } = req.body;
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let users = data.users || [];
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ message: "Username already taken!" });
    }
    
    if (phone && users.find(u => u.phone === phone)) {
        return res.status(400).json({ message: "Phone number already registered!" });
    }
    
    const newUser = {
        id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
        username,
        password,
        phone: phone || "",
        status: "Pending",
        registeredAt: new Date().toISOString()
    };
    
    users.push(newUser);
    data.users = users;
    writeJSON(DATA_FILE, data);
    res.status(201).json(newUser);
});

app.patch('/users/:id', (req, res) => {
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let users = data.users || [];
    const userId = parseInt(req.params.id);
    const userIndex = users.findIndex(u => u.id === userId);
    
    if (userIndex !== -1) {
        users[userIndex].status = req.body.status;
        data.users = users;
        writeJSON(DATA_FILE, data);
        res.json({ success: true, user: users[userIndex] });
    } else {
        res.status(404).json({ message: "User not found" });
    }
});

app.delete('/users/:id', (req, res) => {
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let users = data.users || [];
    const userId = parseInt(req.params.id);
    const deletedUser = users.find(u => u.id === userId);
    users = users.filter(u => u.id !== userId);
    data.users = users;
    writeJSON(DATA_FILE, data);
    
    let orders = readJSON(ORDERS_FILE, []);
    orders = orders.filter(o => o.username !== deletedUser?.username);
    writeJSON(ORDERS_FILE, orders);
    
    res.json({ 
        success: true, 
        message: `User ${deletedUser?.username} deleted along with ${orders.length} orders`
    });
});

// ============ PRODUCT ROUTES ============

app.get('/products', (req, res) => {
    const data = readJSON(DATA_FILE, { products: [] });
    res.json(data.products || []);
});

app.get('/categories', (req, res) => {
    const data = readJSON(DATA_FILE, { products: [], users: [] });
    const products = data.products || [];
    const categories = [...new Set(products.map(p => p.category).filter(c => c && c !== 'General'))];
    res.json(categories);
});

app.post('/products', (req, res) => {
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let products = data.products || [];
    
    let images = [];
    if (req.body.images && Array.isArray(req.body.images) && req.body.images.length > 0) {
        images = req.body.images;
    } else if (req.body.image) {
        images = [req.body.image];
    } else {
        images = ['https://via.placeholder.com/150'];
    }
    
    const newProduct = {
        id: products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1,
        name: req.body.name,
        price: Number(req.body.price),
        stock: Number(req.body.stock),
        category: req.body.category || 'General',
        description: req.body.description || '',
        image: images[0],
        images: images,
        createdAt: new Date().toISOString()
    };
    
    products.push(newProduct);
    data.products = products;
    writeJSON(DATA_FILE, data);
    res.status(201).json(newProduct);
});

// FIXED: Stock update with validation to prevent double updates
app.patch('/products/:id/stock', (req, res) => {
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let products = data.products || [];
    const productId = parseInt(req.params.id);
    const productIndex = products.findIndex(p => p.id === productId);
    
    if (productIndex === -1) {
        return res.status(404).json({ message: "Product not found" });
    }
    
    const changeAmount = Number(req.body.amount);
    const operationKey = `stock_${productId}_${changeAmount}_${req.body.requestId || Date.now()}`;
    
    // Prevent duplicate stock updates
    if (isOperationProcessed(operationKey)) {
        console.log(`Duplicate stock update prevented for product ${productId}`);
        return res.json({ success: true, product: products[productIndex], alreadyProcessed: true });
    }
    
    const newStock = products[productIndex].stock + changeAmount;
    
    if (newStock < 0) {
        return res.status(400).json({ message: "Stock cannot be negative" });
    }
    
    products[productIndex].stock = newStock;
    data.products = products;
    writeJSON(DATA_FILE, data);
    markOperationProcessed(operationKey);
    
    console.log(`Stock updated: Product ${products[productIndex].name} changed by ${changeAmount}, new stock: ${newStock}`);
    res.json({ success: true, product: products[productIndex] });
});

app.patch('/products/:id', (req, res) => {
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let products = data.products || [];
    const productId = parseInt(req.params.id);
    const productIndex = products.findIndex(p => p.id === productId);
    
    if (productIndex === -1) {
        return res.status(404).json({ message: "Product not found" });
    }
    
    if (req.body.name) products[productIndex].name = req.body.name;
    if (req.body.price) products[productIndex].price = Number(req.body.price);
    if (req.body.stock !== undefined) products[productIndex].stock = Number(req.body.stock);
    if (req.body.category) products[productIndex].category = req.body.category;
    if (req.body.description !== undefined) products[productIndex].description = req.body.description;
    if (req.body.image) {
        products[productIndex].image = req.body.image;
        if (!products[productIndex].images) products[productIndex].images = [req.body.image];
    }
    if (req.body.images && Array.isArray(req.body.images)) {
        products[productIndex].images = req.body.images;
        products[productIndex].image = req.body.images[0];
    }
    
    data.products = products;
    writeJSON(DATA_FILE, data);
    res.json({ success: true, product: products[productIndex] });
});

app.delete('/products/:id', (req, res) => {
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let products = data.products || [];
    products = products.filter(p => p.id !== parseInt(req.params.id));
    data.products = products;
    writeJSON(DATA_FILE, data);
    res.json({ success: true });
});

// ============ ORDER ROUTES ============

app.get('/history', (req, res) => {
    const orders = readJSON(ORDERS_FILE, []);
    res.json(orders);
});

// FIXED: Order placement - NO stock reduction here (already reduced in cart)
app.post('/order', (req, res) => {
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let orders = readJSON(ORDERS_FILE, []);
    const products = data.products || [];
    const users = data.users || [];
    
    const { productId, quantity, username, customerName, address, phone, payment_id, payment_status } = req.body;
    
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ message: "User account no longer exists" });
    }
    if (user.status !== 'Verified') {
        return res.status(401).json({ message: "Account not verified" });
    }
    
    const product = products.find(p => p.id === productId);
    
    if (!product) {
        return res.status(404).json({ message: "Product not found" });
    }
    
    // Create order WITHOUT reducing stock again
    const newOrder = {
        orderId: Date.now(),
        username: username || 'Guest',
        customerName: customerName || 'N/A',
        address: address || 'No Address',
        phone: phone || 'N/A',
        productId: product.id,
        productName: product.name,
        description: product.description || '',
        quantity: Number(quantity),
        totalPrice: product.price * Number(quantity),
        date: new Date().toLocaleString(),
        status: "Pending",
        trackingId: "",
        payment_status: payment_status || "pending",
        payment_id: payment_id || ""
    };
    
    orders.push(newOrder);
    writeJSON(ORDERS_FILE, orders);
    
    console.log(`✅ Order created for ${username}: ${product.name} x ${quantity}`);
    res.status(201).json(newOrder);
});

app.patch('/history/:id', (req, res) => {
    let orders = readJSON(ORDERS_FILE, []);
    const orderId = parseInt(req.params.id);
    const orderIndex = orders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex !== -1) {
        if (req.body.status) orders[orderIndex].status = req.body.status;
        if (req.body.trackingId) orders[orderIndex].trackingId = req.body.trackingId;
        writeJSON(ORDERS_FILE, orders);
        res.json(orders[orderIndex]);
    } else {
        res.status(404).json({ message: "Order not found" });
    }
});

// FIXED: Cancel order - restores stock with duplicate prevention
// FIXED: Cancel order - Different rules based on order status
app.patch('/orders/:id/cancel', (req, res) => {
    let orders = readJSON(ORDERS_FILE, []);
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    const orderId = parseInt(req.params.id);
    const orderIndex = orders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex === -1) {
        return res.status(404).json({ message: "Order not found" });
    }
    
    const order = orders[orderIndex];
    
    // Check if order is already cancelled
    if (order.status === 'Cancelled') {
        return res.status(400).json({ message: "Order already cancelled" });
    }
    
    // PREVENT CANCELLATION IF ORDER IS SHIPPED OR DELIVERED
    if (order.status === 'Shipped') {
        return res.status(400).json({ 
            message: "Cannot cancel shipped order. Your order has already been dispatched. Please contact customer support for returns after delivery.",
            alreadyShipped: true
        });
    }
    
    if (order.status === 'Delivered') {
        return res.status(400).json({ 
            message: "Order already delivered. Please use return policy for refunds.",
            alreadyDelivered: true
        });
    }
    
    // Prevent duplicate cancellation
    const cancelKey = `cancel_order_${orderId}`;
    if (isOperationProcessed(cancelKey)) {
        return res.status(400).json({ message: "Order cancellation already in progress" });
    }
    
    // ONLY RESTORE STOCK IF ORDER IS PENDING (not shipped)
    // If seller forgot to update status, the user cannot cancel anyway
    if (order.status === 'Pending') {
        const products = data.products || [];
        const product = products.find(p => p.id === order.productId);
        
        if (product) {
            product.stock += order.quantity;
            data.products = products;
            writeJSON(DATA_FILE, data);
            console.log(`✅ Stock restored for cancelled PENDING order: ${product.name} +${order.quantity} (new stock: ${product.stock})`);
        }
    } else {
        console.log(`⚠️ Order ${orderId} is ${order.status} - No stock restoration on cancellation`);
    }
    
    order.status = 'Cancelled';
    orders[orderIndex] = order;
    writeJSON(ORDERS_FILE, orders);
    markOperationProcessed(cancelKey);
    
    res.json({ 
        success: true, 
        message: order.status === 'Pending' ? "Order cancelled and stock restored" : "Order cancelled (no stock restoration as order was already processed)",
        restoredQuantity: order.status === 'Pending' ? order.quantity : 0,
        productId: order.productId,
        orderStatus: order.status
    });
});
// FIXED: Delete single order with duplicate prevention
app.delete('/orders/:id', (req, res) => {
    let orders = readJSON(ORDERS_FILE, []);
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    const orderId = parseInt(req.params.id);
    const orderIndex = orders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex === -1) {
        return res.status(404).json({ message: "Order not found" });
    }
    
    const order = orders[orderIndex];
    const deleteKey = `delete_order_${orderId}`;
    
    if (isOperationProcessed(deleteKey)) {
        return res.status(400).json({ message: "Order deletion already in progress" });
    }
    
    // Restore stock when admin deletes order (if not already cancelled)
    if (order.status !== 'Cancelled') {
        const products = data.products || [];
        const product = products.find(p => p.id === order.productId);
        if (product) {
            product.stock += order.quantity;
            data.products = products;
            writeJSON(DATA_FILE, data);
            console.log(`✅ Stock restored for deleted order: ${product.name} +${order.quantity}`);
        }
    }
    
    orders = orders.filter(o => o.orderId !== orderId);
    writeJSON(ORDERS_FILE, orders);
    markOperationProcessed(deleteKey);
    
    res.json({ success: true, message: "Order deleted and stock restored" });
});

// ============ PAYMENT ROUTES ============

app.post('/create-order', async (req, res) => {
    try {
        const { amount, currency = 'INR' } = req.body;
        const options = {
            amount: Math.round(amount * 100),
            currency: currency,
            receipt: `receipt_${Date.now()}`,
            payment_capture: 1
        };
        const order = await razorpay.orders.create(options);
        res.json({ success: true, order_id: order.id, amount: order.amount, currency: order.currency });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ success: false, message: 'Failed to create order' });
    }
});

app.post('/verify-payment', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(body).digest('hex');
        
        if (expectedSignature === razorpay_signature) {
            res.json({ success: true, message: 'Payment verified successfully', payment_id: razorpay_payment_id });
        } else {
            res.status(400).json({ success: false, message: 'Payment verification failed' });
        }
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/get-razorpay-key', (req, res) => {
    res.json({ key: RAZORPAY_KEY_ID });
});

// ============ ADMIN ROUTES ============

app.post('/reset-completed-orders', (req, res) => {
    let orders = readJSON(ORDERS_FILE, []);
    const activeOrders = orders.filter(order => order.status === 'Pending' || order.status === 'Shipped');
    writeJSON(ORDERS_FILE, activeOrders);
    res.json({ success: true, message: `Reset completed! ${activeOrders.length} active orders preserved.` });
});

app.post('/reset-history', (req, res) => {
    writeJSON(ORDERS_FILE, []);
    res.json({ success: true, message: "All orders deleted" });
});

// ============ AUTH ROUTES ============

app.get('/auth/check/:username', (req, res) => {
    const data = readJSON(DATA_FILE, { products: [], users: [] });
    const users = data.users || [];
    const username = req.params.username;
    const user = users.find(u => u.username === username);
    
    if (!user) return res.json({ exists: false, verified: false });
    if (user.status !== 'Verified') return res.json({ exists: true, verified: false });
    res.json({ exists: true, verified: true, user: { username: user.username, status: user.status } });
});

app.get('/user/:username', (req, res) => {
    const data = readJSON(DATA_FILE, { products: [], users: [] });
    const users = data.users || [];
    const username = req.params.username;
    const user = users.find(u => u.username === username);
    
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ id: user.id, username: user.username, status: user.status, phone: user.phone });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n✅ ========================================`);
    console.log(`✅ SERVER RUNNING ON http://localhost:${PORT}`);
    console.log(`✅ ========================================`);
    console.log(`📁 Data file: ${DATA_FILE}`);
    console.log(`📁 Orders file: ${ORDERS_FILE}`);
    console.log(`\n💰 PAYMENT MODE: TEST (Razorpay)`);
    console.log(`\n✅ FIXES APPLIED:`);
    console.log(`   - Duplicate stock update prevention using request IDs`);
    console.log(`   - Duplicate order cancellation prevention`);
    console.log(`   - Stock deducted ONLY when adding to cart`);
    console.log(`   - Order placement does NOT deduct stock again`);
    console.log(`\n🌐 OPEN IN BROWSER:`);
    console.log(`   - Admin Panel: http://localhost:${PORT}/admin.html`);
    console.log(`   - Store: http://localhost:${PORT}/index.html`);
    console.log(`   - Login: http://localhost:${PORT}/auth.html`);
    console.log(`\n✅ ========================================\n`);
});
