const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors'); // Add CORS
const connectDB= require('./helper/db.js')
const app = express();

// Middleware
app.use(cors()); // Allow requests from all origins (adjust in production)
app.use(express.json());

// Set up multer for file uploads (snapshots)
const upload = multer({ dest: 'uploads/' });

// Serve uploaded snapshots statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// In-memory storage for snapshots (use a database in production)
const snapshots = new Map();

// Endpoint 1: Upload snapshots from employee app
app.post('/upload-snapshot', upload.single('snapshot'), (req, res) => {
  try {
    const { teamId, employeeId } = req.body;
    if (!teamId || !employeeId) {
      return res.status(400).json({ error: 'teamId and employeeId are required' });
    }

    const url = `http://localhost:3001/uploads/${req.file.filename}`;
    if (!snapshots.has(teamId)) snapshots.set(teamId, {});
    if (!snapshots.get(teamId)[employeeId]) snapshots.get(teamId)[employeeId] = [];
    snapshots.get(teamId)[employeeId].push(url);

    res.json({ url });
  } catch (err) {
    console.error('Error uploading snapshot:', err);
    res.status(500).json({ error: 'Failed to upload snapshot' });
  }
});

// Endpoint 2: Upload application usage data from employee app
app.post('/upload-app-usage', (req, res) => {
  try {
    console.log('Request body:', req.body);

    if (!req.body) {
      return res.status(400).json({ error: 'Request body is missing or not in JSON format' });
    }

    const { appName, windowTitle, teamId, employeeId, timestamp } = req.body;
    if (!appName || !teamId || !employeeId || !timestamp) {
      return res.status(400).json({ error: 'appName, teamId, employeeId, and timestamp are required' });
    }

    console.log(`App usage for ${employeeId} in team ${teamId}: ${appName} - ${windowTitle} at ${new Date(timestamp)}`);

    res.json({ status: 'success' });
  } catch (err) {
    console.error('Error uploading app usage:', err);
    res.status(500).json({ error: 'Failed to upload app usage' });
  }
});

// Endpoint 3: Get snapshots for a team (for manager app)
// app.get('/snapshots', (req, res) => {
//   try {
//     const { teamId } = req.query;
//     if (!teamId) {
//       return res.status(400).json({ error: 'teamId is required' });
//     }

//     res.json(snapshots.get(teamId) || {});
//   } catch (err) {
//     console.error('Error retrieving snapshots:', err);
//     res.status(500).json({ error: 'Failed to retrieve snapshots' });
//   }
// });

// Start the server
app.listen(3001, () =>
{  
  console.log('Backend running on port 3001')

connectDB()
}
);