const RosTrustProcessing = require('./ros_trust_processing');
const SettlexProcessing = require('./settlex_processing');
const { PROCESSING_ROS_TRUST_API_URL, PROCESSING_ROS_TRUST_API_KEY, PROCESSING_ROS_TRUST_SECRET, PROCESSING_SETTLEX_API_URL, PROCESSING_SETTLEX_API_KEY } = require('../config/constants');
const { loadJson } = require('../utils/storage_utils');

function getProcessing() {
    const config = loadJson('config') || {};
    const processingType = config.processingType || 'none';
    
    if (processingType === 'ros_trust_processing') {
        return new RosTrustProcessing(PROCESSING_ROS_TRUST_API_URL, PROCESSING_ROS_TRUST_API_KEY, PROCESSING_ROS_TRUST_SECRET);
    } else if (processingType === 'settlex_processing') {
        const processingSettlexApiUrl = PROCESSING_SETTLEX_API_URL || PROCESSING_ROS_TRUST_API_URL;
        const processingSettlexApiKey = PROCESSING_SETTLEX_API_KEY || PROCESSING_ROS_TRUST_API_KEY;
        return new SettlexProcessing(processingSettlexApiUrl, processingSettlexApiKey);
    }
    
    return null;
}

function isProcessingEnabled() {
    const config = loadJson('config') || {};
    const processingType = config.processingType || 'none';
    return processingType !== 'none';
}

module.exports = {
    getProcessing,
    isProcessingEnabled,
    RosTrustProcessing,
    SettlexProcessing
};
