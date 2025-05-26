const mongoose = require('mongoose');

const appUsageSchema = new mongoose.Schema({
  appName: String,
  windowTitle: String,
  teamId: String,
  employeeId: String,
  timestamp: Date
});

module.exports = mongoose.model('AppUsage', appUsageSchema);
