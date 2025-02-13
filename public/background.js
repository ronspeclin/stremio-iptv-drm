console.log('IPTV Addon Background Script');
module.exports = {
    init: function(addonConfig) {
        console.log('Addon initialized', addonConfig);
        return Promise.resolve();
    }
};