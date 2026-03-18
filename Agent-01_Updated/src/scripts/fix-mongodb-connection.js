/**
 * MongoDB Connection Fix Helper
 * Helps diagnose and fix MongoDB Atlas connection issues
 */

import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

async function getCurrentIP() {
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.ipify.org', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(data.trim()); });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function testMongoConnection() {
  try {
    const mongoose = await import('mongoose');
    const uri = process.env.MONGODB_URI;
    
    if (!uri) {
      console.log('❌ MONGODB_URI not found in .env file');
      console.log('   Check that .env file exists and has MONGODB_URI set');
      return false;
    }
    
    // Mask password in URI for display
    const maskedUri = uri.replace(/:([^:@]+)@/, ':****@');
    console.log(`🔄 Testing MongoDB connection...`);
    console.log(`   URI: ${maskedUri.substring(0, 50)}...`);
    
    await mongoose.default.connect(uri, { 
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    });
    console.log('✅ MongoDB connection successful!');
    await mongoose.default.disconnect();
    return true;
  } catch (error) {
    console.log(`\n❌ Connection Error: ${error.message}\n`);
    
    if (error.message.includes('whitelist') || error.message.includes('IP')) {
      console.log('💡 This is an IP whitelist issue.');
      console.log('   Even though 0.0.0.0/0 is Active, it may take a few more minutes to propagate.');
      return false;
    }
    
    if (error.message.includes('authentication')) {
      console.log('💡 This is an authentication issue.');
      console.log('   Check your MongoDB username and password in MONGODB_URI');
      return false;
    }
    
    if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      console.log('💡 This is a DNS/network issue.');
      console.log('   Check your MongoDB URI is correct');
      return false;
    }
    
    console.log('💡 Full error details:');
    console.log(`   ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('\n=== MongoDB Connection Fix Helper ===\n');
  
  // Get current IP
  try {
    const currentIP = await getCurrentIP();
    console.log(`📍 Your Current IP Address: ${currentIP}\n`);
    
    // Test connection
    const connected = await testMongoConnection();
    
    if (connected) {
      console.log('\n✅ MongoDB is already connected! No action needed.\n');
      return;
    }
    
    console.log('❌ MongoDB connection failed - IP whitelist issue\n');
    
    console.log('📋 Step-by-Step Fix Instructions:\n');
    console.log('1. Open MongoDB Atlas in your browser:');
    console.log('   https://cloud.mongodb.com/\n');
    console.log('2. Sign in to your account\n');
    console.log('3. Navigate to Network Access:');
    console.log('   - Click on your project/cluster');
    console.log('   - Go to "Security" → "Network Access" (or "IP Access List")\n');
    console.log('4. Add your IP address:');
    console.log(`   - Click "Add IP Address" or "Add Entry"`);
    console.log(`   - Enter: ${currentIP}`);
    console.log(`   - Or click "Add Current IP Address" if available`);
    console.log(`   - Click "Confirm"\n`);
    console.log('5. Wait 1-2 minutes for changes to take effect\n');
    console.log('6. Test again by running:');
    console.log('   node src/scripts/fix-mongodb-connection.js\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('💡 Alternative (Development Only):');
    console.log('   Add IP: 0.0.0.0/0 (allows all IPs)');
    console.log('   ⚠️  WARNING: Only use for development, not production!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📝 Quick Copy-Paste:');
    console.log(`   IP to add: ${currentIP}\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n💡 Manual Steps:');
    console.log('   1. Visit: https://www.whatismyip.com/');
    console.log('   2. Copy your IP address');
    console.log('   3. Go to MongoDB Atlas → Network Access');
    console.log('   4. Add your IP address');
  }
}

main();

