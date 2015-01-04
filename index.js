var EventEmitter = require('events').EventEmitter;
var net = require('net');
var util = require('util');

var topic, message;
var previous = [];

var opentherm_ids = {
        0: "flame_status",
        1: "control_setpoint",
        9: "remote_override_setpoint",
        16: "room_setpoint",
        24: "room_temperature",
        25: "boiler_water_temperature",
        26: "dhw_temperature",
        28: "return_water_temperature",
        116: "burner_starts",
        117: "ch_pump_starts",
        119: "dhw_burner_starts",
        120: "burner_operation_hours",
        121: "ch_pump_operation_hours",
        123: "dhw_burner_operation_hours"
};

var opentherm_ids_types = {
        0: "flag8",
        1: "f8.8",
        9: "f8.8",
        16: "f8.8",
        24: "f8.8",
        25: "f8.8",
        26: "f8.8",
        28: "f8.8",
        116: "u16",
        117: "u16",
        119: "u16",
        120: "u16",
        121: "u16",
        123: "u16"
};

util.inherits(OTGateway, EventEmitter);

function padLeft(nr, n, str){
  return Array(n-String(nr).length+1).join(str||'0')+nr;
}

function OTGateway(ip, port) {
  this.ip = ip;
  this.port = port;
  this.interval = 20000;
  this.isConnected = false;
  this.busy = false;
  this.callback = null;
  this.dutyCycle = 0;
  this.memorySlots = 0;

  this.rooms = [];
  this.devices = {};
  this.deviceCount = 0;
  this.client = new net.Socket();
  var self = this;
  this.client.on('error', function(err){
    self.emit('error', err);
  });

  this.client.on('data', this.onData.bind(this));

  this.connect();
}

OTGateway.prototype.connect = function () {
  if (!this.isConnected) {
    this.client.connect(this.port, this.ip, function() {
      //console.log('Connected');
      this.isConnected = true;
      this.emit('connected');
    }.bind(this));
  } else {
    this.send('l:\r\n');
  }

  setTimeout(this.connect.bind(this), this.interval);
};

OTGateway.prototype.send = function (message, callback) {
  if (!this.busy) {
    //console.log('Sending command: ' + message.substr(0,1));
    this.busy = true;
    this.client.write(message, 'utf-8', callback);
  }
};

OTGateway.prototype.onData = function (data) {
  data = data.toString('utf-8');
  data = data.split('\r\n');
  data.forEach(function (line) {
    if (line.length > 0) {
     // check for OT packets
     // console.log(line);
        opentherm_target = line.slice(0, 1); // B, T, A, R, E
        opentherm_type = line.slice(1, 2); //
        opentherm_id = parseInt(line.slice(3, 5), 16); //
        opentherm_payload = line.slice(-4); // last 4 chars

        //if (opentherm_target == "B" || opentherm_target == "T" || opentherm_target == "A" || opentherm_target == "R" || opentherm_target == "E") {
        if (opentherm_target == "B" || opentherm_target == "T" || opentherm_target == "A") {
                // if (opentherm_type == "1" || opentherm_type == "4" || opentherm_type == "C" || opentherm_type == "9") {
                if (opentherm_type == "1" || opentherm_type == "4") {
                        if (opentherm_id in opentherm_ids) {
                                topic = opentherm_ids[opentherm_id];
                                switch (opentherm_ids_types[opentherm_id]) {
                                        case 'flag8':
                                                message = parseInt(opentherm_payload, 16).toString(2);
                                                break;

                                        case 'f8.8':
                                                message = (parseInt(opentherm_payload, 16) / 256).toFixed(2);
                                                break;

                                        case 'u16':
                                                message = parseInt(opentherm_payload, 16);
                                                break;
                                }

                                 //console.log(String(previous[topic] + previous[message]));
                                 //console.log(String(topic+message));
                                 //console.log(String((topic + message) (previous[topic] + previous[message])));
                                if ((topic + message) != (previous[topic] + previous[message])) {
                                        this.emit(topic, String(message));
                                        previous[topic] = topic;
                                        previous[message] = message;
                                }
                        }
                }
        } else if (opentherm_target == "T" && (opentherm_type == "T" || opentherm_type == "C")) {
          this.emit('response',line);
        }

    }
  }.bind(this));

  this.busy = false;
};

//NOT functional atm
OTGateway.prototype.setTemperature = function (mode, temperature, callback) {

  if (!this.isConnected) {
    callback(new Error("Not connected"));
    return;
  }

  var data;
  switch (mode) {
    case 'auto':
      data = 'TT=00';
      break;
    case 'manu':
      data = 'TT=' + temperature;
      break;
    case 'boost':
      data = 'TC=' + temperature;
      break;
    default:
      callback(new Error('Unknown mode: ' + mode));
      return false;
  }

  this.send(data, function(err) {
      if(err && callback) { 
        callback(err); 
        callback = null;
      }
  });

  this.once('response', function(res) {
    if(!callback) {
      return;
    }
    if(res == "NG" || res == "SE" || res == "BV" || res == "OR" || res == "NS" || res == "NF" || res == "OE") {
      var reason = "";
      switch(res) {
        case "NG":
          reason = "No Good: The command code is unknown.";
          break;
        case "SE":
          reason = "Syntax Error: The command contained an unexpected character or was incomplete.";
          break;
        case "BV":
          reason = "Bad Value: The command contained a data value that is not allowed.";
          break;
        case "OR":
          reason = "Out of Range: A number was specified outside of the allowed range.";
          break;
        case "NS":
          reason = "No Space: The alternative Data-ID could not be added because the table is full.";
          break;
        case "NF":
          reason = "Not Found: The specified alternative Data-ID could not be removed because it does not exist in the table.";
          break; 
        case "OE":
          reason = "Overrun Error: The processor was busy and failed to process all received characters.";
          break;
      }
      callback(new Error('Command was rejected, Reason: ' + reason));
    } else {
      callback(null);
    }
    callback = null;
  });
};

module.exports = OTGateway;
