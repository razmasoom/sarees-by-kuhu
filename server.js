const express = require('express');
const cors = require('cors');
const fs = require('fs');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, 'data.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const CANCELLATION_REQUESTS_FILE = path.join(__dirname, 'cancellation_requests.json');
const ADDRESSES_FILE = path.join(__dirname, 'addresses.json');

// Track processed operations to prevent duplicates
const processedOperations = new Map();

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

const initOrdersFile = () => {
    if (!fs.existsSync(ORDERS_FILE)) {
        writeJSON(ORDERS_FILE, []);
    }
};

const initCancellationRequestsFile = () => {
    if (!fs.existsSync(CANCELLATION_REQUESTS_FILE)) {
        writeJSON(CANCELLATION_REQUESTS_FILE, []);
    }
};

const initAddressesFile = () => {
    if (!fs.existsSync(ADDRESSES_FILE)) {
        writeJSON(ADDRESSES_FILE, []);
    }
};

initDataFile();
initOrdersFile();
initCancellationRequestsFile();
initAddressesFile();

// ============ REFUND ROUTE ============

// Process refund for cancelled order
async function processRefund(paymentId, amount, reason = "Order cancelled by seller approval") {
    try {
        console.log(`🔄 Processing refund for Payment ID: ${paymentId}, Amount: ₹${amount}`);
        
        // Check if it's a test payment (no actual refund needed)
        if (paymentId === "test_payment") {
            console.log(`✅ Test mode refund processed (no actual refund) for ${paymentId}`);
            return { success: true, message: "Test mode refund processed", refundId: "test_refund_" + Date.now() };
        }
        
        // Create refund using Razorpay API
        const refund = await razorpay.payments.refund(paymentId, {
            amount: Math.round(amount * 100), // Amount in paise
            speed: 'normal',
            notes: {
                reason: reason,
                refund_initiated_by: "admin",
                timestamp: new Date().toISOString()
            }
        });
        
        console.log(`✅ Refund successful! Refund ID: ${refund.id}`);
        return { success: true, refundId: refund.id, refundData: refund };
        
    } catch (error) {
        console.error(`❌ Refund failed for payment ${paymentId}:`, error);
        
        // Handle specific Razorpay errors
        if (error.error && error.error.code === 'BAD_REQUEST_ERROR') {
            return { success: false, error: "Invalid payment ID or payment already refunded" };
        } else if (error.error && error.error.code === 'PAYMENT_NOT_FOUND') {
            return { success: false, error: "Payment not found" };
        }
        
        return { success: false, error: error.message || "Refund processing failed" };
    }
}

// ============ ADDRESS ROUTES ============

// Get all addresses for a user
app.get('/addresses/:username', (req, res) => {
    const addresses = readJSON(ADDRESSES_FILE, []);
    const userAddresses = addresses.filter(a => a.username === req.params.username);
    res.json(userAddresses);
});

// Add new address
app.post('/addresses', (req, res) => {
    const addresses = readJSON(ADDRESSES_FILE, []);
    const { username, name, phone, addressLine, city, state, pincode, addressType, isDefault } = req.body;
    
    const newAddress = {
        id: Date.now(),
        username,
        name,
        phone,
        addressLine,
        city,
        state,
        pincode,
        addressType: addressType || 'Home',
        isDefault: isDefault || false,
        createdAt: new Date().toISOString()
    };
    
    // If this is default, remove default from other addresses
    if (newAddress.isDefault) {
        addresses.forEach(a => {
            if (a.username === username) a.isDefault = false;
        });
    } else {
        // If no default exists, make this default
        const hasDefault = addresses.some(a => a.username === username && a.isDefault);
        if (!hasDefault) newAddress.isDefault = true;
    }
    
    addresses.push(newAddress);
    writeJSON(ADDRESSES_FILE, addresses);
    res.status(201).json(newAddress);
});

// Update address
app.put('/addresses/:id', (req, res) => {
    const addresses = readJSON(ADDRESSES_FILE, []);
    const id = parseInt(req.params.id);
    const index = addresses.findIndex(a => a.id === id);
    
    if (index === -1) {
        return res.status(404).json({ message: "Address not found" });
    }
    
    const { name, phone, addressLine, city, state, pincode, addressType, isDefault } = req.body;
    const username = addresses[index].username;
    
    addresses[index] = { ...addresses[index], name, phone, addressLine, city, state, pincode, addressType };
    
    if (isDefault) {
        addresses.forEach(a => {
            if (a.username === username) a.isDefault = false;
        });
        addresses[index].isDefault = true;
    }
    
    writeJSON(ADDRESSES_FILE, addresses);
    res.json(addresses[index]);
});

// Delete address
app.delete('/addresses/:id', (req, res) => {
    const addresses = readJSON(ADDRESSES_FILE, []);
    const id = parseInt(req.params.id);
    const addressToDelete = addresses.find(a => a.id === id);
    const filtered = addresses.filter(a => a.id !== id);
    
    // If deleted address was default, set another as default
    if (addressToDelete && addressToDelete.isDefault && filtered.length > 0) {
        const userAddresses = filtered.filter(a => a.username === addressToDelete.username);
        if (userAddresses.length > 0) {
            userAddresses[0].isDefault = true;
        }
    }
    
    writeJSON(ADDRESSES_FILE, filtered);
    res.json({ success: true });
});

// Set default address
app.patch('/addresses/:id/default', (req, res) => {
    const addresses = readJSON(ADDRESSES_FILE, []);
    const id = parseInt(req.params.id);
    const index = addresses.findIndex(a => a.id === id);
    
    if (index === -1) {
        return res.status(404).json({ message: "Address not found" });
    }
    
    const username = addresses[index].username;
    addresses.forEach(a => {
        if (a.username === username) a.isDefault = false;
    });
    addresses[index].isDefault = true;
    
    writeJSON(ADDRESSES_FILE, addresses);
    res.json(addresses[index]);
});

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
        id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 2,
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
    
    // Delete user's addresses
    let addresses = readJSON(ADDRESSES_FILE, []);
    addresses = addresses.filter(a => a.username !== deletedUser?.username);
    writeJSON(ADDRESSES_FILE, addresses);
    
    res.json({ 
        success: true, 
        message: `User ${deletedUser?.username} deleted along with their orders and addresses`
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
        id: products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 4,
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

app.post('/order', (req, res) => {
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let orders = readJSON(ORDERS_FILE, []);
    const products = data.products || [];
    const users = data.users || [];
    
    const { items, username, customerName, address, phone, payment_id, payment_status } = req.body;
    
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.status !== 'Verified') return res.status(401).json({ message: "Account not verified" });
    
    const orderId = Date.now();
    let totalAmount = 0;
    const orderItems = [];
    
    if (items && Array.isArray(items)) {
        for (const item of items) {
            const product = products.find(p => p.id === item.productId);
            if (!product) continue;
            
            const itemTotal = product.price * item.quantity;
            totalAmount += itemTotal;
            
            orderItems.push({
                productId: product.id,
                productName: product.name,
                description: product.description || '',
                quantity: item.quantity,
                price: product.price,
                subtotal: itemTotal
            });
        }
    }
    
    const newOrder = {
        orderId: orderId,
        username: username || 'Guest',
        customerName: customerName || 'N/A',
        address: address || 'No Address',
        phone: phone || 'N/A',
        items: orderItems,
        totalAmount: totalAmount,
        date: new Date().toLocaleString(),
        status: "Pending",
        trackingId: "",
        payment_status: payment_status || "pending",
        payment_id: payment_id || "",
        refund_status: "none", // Track refund status: none, processing, completed, failed
        refund_id: null
    };
    
    orders.push(newOrder);
    writeJSON(ORDERS_FILE, orders);
    
    console.log(`✅ Order #${orderId} created for ${username} with ${orderItems.length} items, total: ₹${totalAmount}, Payment ID: ${payment_id}`);
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
    
    // Restore stock for deleted order items
    if (order.items && order.items.length > 0) {
        const products = data.products || [];
        for (const item of order.items) {
            const product = products.find(p => p.id === item.productId);
            if (product) {
                product.stock += item.quantity;
                console.log(`✅ Stock restored for deleted order item: ${product.name} +${item.quantity}`);
            }
        }
        data.products = products;
        writeJSON(DATA_FILE, data);
    }
    
    orders = orders.filter(o => o.orderId !== orderId);
    writeJSON(ORDERS_FILE, orders);
    markOperationProcessed(deleteKey);
    
    res.json({ success: true, message: "Order deleted and stock restored" });
});

// ============ CANCELLATION REQUEST ROUTES WITH REFUND ============

app.post('/orders/:id/request-cancel', (req, res) => {
    let orders = readJSON(ORDERS_FILE, []);
    let cancellationRequests = readJSON(CANCELLATION_REQUESTS_FILE, []);
    const orderId = parseInt(req.params.id);
    const orderIndex = orders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex === -1) {
        return res.status(404).json({ message: "Order not found" });
    }
    
    const order = orders[orderIndex];
    
    if (order.status === 'Cancelled') {
        return res.status(400).json({ message: "Order already cancelled" });
    }
    
    if (order.status === 'Delivered') {
        return res.status(400).json({ message: "Delivered orders cannot be cancelled" });
    }
    
    if (order.status === 'Shipped') {
        return res.status(400).json({ message: "Order has already been shipped and cannot be cancelled" });
    }
    
    const existingRequest = cancellationRequests.find(r => r.orderId === orderId);
    if (existingRequest && existingRequest.status === 'pending') {
        return res.status(400).json({ message: "Cancellation already requested, waiting for approval" });
    }
    if (existingRequest && existingRequest.status === 'approved') {
        return res.status(400).json({ message: "Order already cancelled" });
    }
    if (existingRequest && existingRequest.status === 'rejected') {
        return res.status(400).json({ message: "Previous cancellation request was rejected by seller" });
    }
    
    const request = {
        id: Date.now(),
        orderId: orderId,
        username: order.username,
        items: order.items,
        status: 'pending',
        requestedAt: new Date().toISOString(),
        orderDetails: order
    };
    
    cancellationRequests.push(request);
    writeJSON(CANCELLATION_REQUESTS_FILE, cancellationRequests);
    
    console.log(`📋 Cancellation requested for order #${orderId} by ${order.username}`);
    res.json({ 
        success: true, 
        message: "Cancellation request submitted. Waiting for seller approval.",
        request: request
    });
});

app.get('/cancellation-requests', (req, res) => {
    const requests = readJSON(CANCELLATION_REQUESTS_FILE, []);
    res.json(requests);
});

app.post('/cancellation-requests/:requestId/approve', async (req, res) => {
    let orders = readJSON(ORDERS_FILE, []);
    let data = readJSON(DATA_FILE, { products: [], users: [] });
    let cancellationRequests = readJSON(CANCELLATION_REQUESTS_FILE, []);
    
    const requestId = parseInt(req.params.requestId);
    const requestIndex = cancellationRequests.findIndex(r => r.id === requestId);
    
    if (requestIndex === -1) {
        return res.status(404).json({ message: "Request not found" });
    }
    
    const request = cancellationRequests[requestIndex];
    
    if (request.status !== 'pending') {
        return res.status(400).json({ message: `Request already ${request.status}` });
    }
    
    const orderId = request.orderId;
    const orderIndex = orders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex === -1) {
        return res.status(404).json({ message: "Order not found" });
    }
    
    const order = orders[orderIndex];
    
    if (order.status === 'Shipped') {
        request.status = 'rejected';
        request.rejectedReason = 'Order has already been shipped';
        request.processedAt = new Date().toISOString();
        cancellationRequests[requestIndex] = request;
        writeJSON(CANCELLATION_REQUESTS_FILE, cancellationRequests);
        
        return res.status(400).json({ 
            success: false, 
            message: "Cannot cancel - order has already been shipped!",
            alreadyShipped: true
        });
    }
    
    if (order.status === 'Cancelled') {
        request.status = 'rejected';
        request.rejectedReason = 'Order already cancelled';
        cancellationRequests[requestIndex] = request;
        writeJSON(CANCELLATION_REQUESTS_FILE, cancellationRequests);
        
        return res.status(400).json({ message: "Order already cancelled" });
    }
    
    const approveKey = `approve_cancel_${orderId}`;
    if (isOperationProcessed(approveKey)) {
        return res.status(400).json({ message: "Approval already in progress" });
    }
    
    // PROCESS REFUND FIRST
    let refundResult = null;
    if (order.payment_id && order.payment_id !== "test_payment") {
        console.log(`💰 Initiating refund for order #${orderId} - Payment ID: ${order.payment_id}, Amount: ₹${order.totalAmount}`);
        
        refundResult = await processRefund(order.payment_id, order.totalAmount, "Order cancelled by seller approval");
        
        if (!refundResult.success) {
            console.error(`❌ Refund failed for order #${orderId}: ${refundResult.error}`);
            return res.status(500).json({ 
                success: false, 
                message: `Refund failed: ${refundResult.error}. Cannot approve cancellation.`,
                refundError: refundResult.error
            });
        }
        
        console.log(`✅ Refund processed successfully! Refund ID: ${refundResult.refundId}`);
        order.refund_status = "completed";
        order.refund_id = refundResult.refundId;
        order.refund_processed_at = new Date().toISOString();
    } else {
        console.log(`ℹ️ Test payment - No refund needed for order #${orderId}`);
        order.refund_status = "test_mode";
        order.refund_id = "test_refund_" + Date.now();
    }
    
    // Restore stock
    const products = data.products || [];
    if (order.items && order.items.length > 0) {
        for (const item of order.items) {
            const product = products.find(p => p.id === item.productId);
            if (product) {
                product.stock += item.quantity;
                console.log(`✅ Stock restored for cancelled order: ${product.name} +${item.quantity}`);
            }
        }
        data.products = products;
        writeJSON(DATA_FILE, data);
    }
    
    // Update order status to Cancelled
    order.status = 'Cancelled';
    order.cancelled_at = new Date().toISOString();
    orders[orderIndex] = order;
    writeJSON(ORDERS_FILE, orders);
    
    // Update cancellation request
    request.status = 'approved';
    request.processedAt = new Date().toISOString();
    request.refund_status = order.refund_status;
    request.refund_id = order.refund_id;
    cancellationRequests[requestIndex] = request;
    writeJSON(CANCELLATION_REQUESTS_FILE, cancellationRequests);
    
    markOperationProcessed(approveKey);
    
    // Send success response with refund info
    const refundMessage = order.payment_id === "test_payment" 
        ? " (Test mode - no actual refund processed)"
        : ` Refund of ₹${order.totalAmount} has been initiated to the original payment method.`;
    
    res.json({ 
        success: true, 
        message: `✅ Cancellation approved! Stock restored.${refundMessage}`,
        refund: refundResult
    });
});

app.post('/cancellation-requests/:requestId/reject', (req, res) => {
    let cancellationRequests = readJSON(CANCELLATION_REQUESTS_FILE, []);
    
    const requestId = parseInt(req.params.requestId);
    const requestIndex = cancellationRequests.findIndex(r => r.id === requestId);
    
    if (requestIndex === -1) {
        return res.status(404).json({ message: "Request not found" });
    }
    
    const request = cancellationRequests[requestIndex];
    
    if (request.status !== 'pending') {
        return res.status(400).json({ message: `Request already ${request.status}` });
    }
    
    request.status = 'rejected';
    request.rejectedReason = req.body.reason || 'Cancellation rejected by seller';
    request.processedAt = new Date().toISOString();
    cancellationRequests[requestIndex] = request;
    writeJSON(CANCELLATION_REQUESTS_FILE, cancellationRequests);
    
    res.json({ 
        success: true, 
        message: "Cancellation request rejected (No refund will be processed)",
        reason: request.rejectedReason
    });
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
    console.log(`📁 Cancellation requests file: ${CANCELLATION_REQUESTS_FILE}`);
    console.log(`📁 Addresses file: ${ADDRESSES_FILE}`);
    console.log(`\n💰 PAYMENT MODE: TEST (Razorpay)`);
    console.log(`🔄 REFUNDS: Enabled - Auto-refund on cancellation approval`);
    console.log(`\n🌐 OPEN IN BROWSER:`);
    console.log(`   - Admin Panel: http://localhost:${PORT}/admin.html`);
    console.log(`   - Store: http://localhost:${PORT}/index.html`);
    console.log(`   - Login: http://localhost:${PORT}/auth.html`);
    console.log(`\n✅ ========================================\n`);
});
