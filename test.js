OTGWConnection = require('./index.js');

var otgw = new OTGWConnection("192.168.178.19", 7686);

otgw.on("flame_status", function (data) {
  console.log("flame: " + data);
})