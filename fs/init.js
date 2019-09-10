// Load Mongoose OS API
load('api_timer.js');
load('api_gpio.js');
load('api_sys.js');
load('api_mqtt.js');
load('api_config.js');
load('api_log.js');
load('api_math.js');
load('api_file.js');
load('api_rpc.js');

/*
 * get event values, lookup mongoose.h:
 *
 * #define MG_MQTT_CMD_CONNACK 2
 * #define MG_MQTT_EVENT_BASE 200
 *
 * #define MG_EV_CLOSE 5
 *
 * #define MG_EV_MQTT_CONNACK (MG_MQTT_EVENT_BASE + MG_MQTT_CMD_CONNACK)
 *
*/

// (convert A-Z to a-z)
let tolowercase = function(s) {
    let ls = '';
    for (let i = 0; i < s.length; i++) {
	let ch = s.at(i);
	if(ch >= 0x41 && ch <= 0x5A)
	    ch |= 0x20;
	ls += chr(ch);
    }
    return ls;
};


// define variables
let MG_EV_MQTT_CONNACK = 202;
let MG_EV_CLOSE = 5;
let client_id = Cfg.get('device.id');
let thing_id = tolowercase(client_id.slice(client_id.length-6, client_id.length));
let base_topic = 'homie/ohsb' + thing_id;
let state_topic = base_topic + '/$state';
let stats_topic = base_topic + '/$stats';
let hab_state_topic = base_topic + '/switch/state';	// see homie_init
let hab_control_topic = hab_state_topic + '/set';
let hab_oncount_topic = base_topic + '/switch/oncount';	// see homie_init
let led_onboard = 13; // Sonoff LED pin
let relay_pin = 12;  // Sonoff relay pin
let spare_pin = 14;  // Sonoff not connected
let button_pin = 0;  // Sonoff push button
let relay_value = 0;
let last_toggle = 0;
let tick_count = 0;
let mqtt_connected = false;
let clock_sync = false;
let relay_last_on_ts = null;
let oncount = 0; // relay ON state duration
// homie-required last will
if(Cfg.get('mqtt.will_topic') !== state_topic) {
	Cfg.set({mqtt: {will_topic: state_topic}});
	Cfg.set({mqtt: {will_message: 'lost'}});
	Cfg.set({mqtt: {client_id: client_id}});
	Log.print(Log.INFO, 'MQTT last will has been updated');
};

// init hardware
GPIO.set_mode(relay_pin, GPIO.MODE_OUTPUT);
GPIO.write(relay_pin, 0);  // default to off

GPIO.set_mode(spare_pin, GPIO.MODE_INPUT);
GPIO.set_mode(button_pin, GPIO.MODE_INPUT);

// read timer schedules from a json file, must be in UTC
let sch = [];

let load_sch = function() {
	sch = [];  // reset sch
	let ok = false;
	let schedules = File.read('schedules.json');
	if ( schedules !== null) {
	  let sch_obj = JSON.parse(schedules);
	  if (sch_obj !== null) {
		sch = sch_obj.sch;
		ok = true;
		Log.print(Log.INFO, 'loaded schedules from file:' + JSON.stringify(sch));
	  } else {
		Log.print(Log.ERROR, 'schedule file corrupted.');
	  }
	} else {
	  Log.print(Log.ERROR, 'schedule file missing.');
	}
	return ok;
};

// set RPC command to reload schedule timer
// call me after a new schedules.json file is put into the fs
RPC.addHandler('ReloadSchedule', function(args) {
     // no args parsing required
     let response = {
		result: load_sch() ? 'OK' : 'Failed'
	 };
     return JSON.stringify(response);
});

let publish = function (topic, msg) {
    let ok = MQTT.pub(topic, msg, 1, true);	// QoS = 1, retain
    Log.print(Log.INFO, 'Published:' + (ok ? 'OK' : 'FAIL') + ' topic:' + topic + ' msg:' +  msg);
    return ok;
};


// notify server of switch state
let update_state = function(full) {
    let uptime = Sys.uptime();
    if (relay_last_on_ts !== null) {
    	oncount += uptime - relay_last_on_ts;
    }
    if (relay_value) {
    	relay_last_on_ts = uptime;
    } else {
    	relay_last_on_ts = null;
    }
    publish(hab_state_topic, relay_value ? 'true' : 'false');
    if (publish(hab_oncount_topic, JSON.stringify(Math.floor(oncount)))){
	oncount = 0;  // reset ON counter, openHAB takes care of statistics logic
    }
    if(full){
//    publish(stats_topic + '/uptime', JSON.stringify(Math.floor(uptime)));
//    publish(stats_topic + '/freeheap', JSON.stringify(Sys.free_ram()));
    }
};

// set switch with bounce protection
let set_switch = function(value) {
    if ( (Sys.uptime() - last_toggle ) > 2 ) {
        GPIO.write(relay_pin, value);
        relay_value = value;
        last_toggle = Sys.uptime();
    } else {
        Log.print(Log.ERROR, 'Bounce protection: operation aborted.');
    }
};

// toggle switch with bounce protection
let toggle_switch = function() {
    if ( (Sys.uptime() - last_toggle ) > 2 ) {
        GPIO.toggle(relay_pin);
        relay_value = 1 - relay_value; // 0 1 toggle
        last_toggle = Sys.uptime();
    } else {
        Log.print(Log.ERROR, 'Bounce protection: operation aborted.');
    }
};

// check schedule and fire if time reached
let run_sch = function () {
  Log.print(Log.DEBUG, 'schedules:' + JSON.stringify(sch));
	let now = Math.floor(Timer.now());
	// calc current time of day from mg_time
	let min_of_day = Math.floor((now % 86400) / 60);
	// calc current day of week from mg_time
	let day_of_week = Math.floor((now % ( 86400 * 7 )) / 86400) + 4; // epoch is Thu
	Log.print(Log.DEBUG, "run_sch: Now is " + JSON.stringify(min_of_day) + " minutes of day " + JSON.stringify(day_of_week) );

	for (let count = 0; count < sch.length; count++ ) {
		if (JSON.stringify(min_of_day) === JSON.stringify(sch[count].hour * 60 + sch[count].min)) {
			Log.print(Log.INFO, '### run_sch: fire action: ' + sch[count].label);
			set_switch(sch[count].value);
			update_state();
		}
	}
};

// sonoff button pressed */
GPIO.set_button_handler(button_pin, GPIO.PULL_UP, GPIO.INT_EDGE_NEG, 500, function(x) {
    Log.print(Log.DEBUG, 'button pressed');
    toggle_switch();
    update_state(false);
}, true);

MQTT.sub(hab_control_topic, function(conn, topic, command) {
    Log.print(Log.DEBUG, 'rcvd ctrl msg:' + command);

    if ( command === 'true' ) {
        set_switch(1);
    } else if ( command === 'false' ) {
        set_switch(0);
    } else {
        Log.print(Log.ERROR, 'Unsupported command');
    }
    update_state(false);
}, null);

MQTT.setEventHandler(function(conn, ev, edata) {
    if (ev === MG_EV_MQTT_CONNACK) {
        mqtt_connected = true;
        Log.print(Log.INFO, 'MQTT connected');
        // auto-discovery
        homie_init();
        update_state(true);
    }
    else if (ev === MG_EV_CLOSE) {
        mqtt_connected = false;
        Log.print(Log.ERROR, 'MQTT disconnected');
    }
}, null);

// check sntp sync, to be replaced by sntp event handler after implemented by OS
let clock_check_timer = Timer.set(30000 , true /* repeat */, function() {
	if (Timer.now() > 1498867200 /* 2017-07-01 */) {
		clock_sync = true;
		load_sch();
		Timer.del(clock_check_timer);
		Log.print(Log.INFO, 'clock_check_timer: clock sync ok');
	} else {
		Log.print(Log.INFO, 'clock_check_timer: clock not sync yet');
	}
}, null);

// timer loop to update state and run schedule jobs
let main_loop_timer = Timer.set(1000 /* 1 sec */, true /* repeat */, function() {
  tick_count++;
  if ( (tick_count % 60) === 0 ) {
	  if (clock_sync) run_sch();
  }

  if ( (tick_count % 300) === 0 ) {
	  tick_count = 0;
      if (mqtt_connected) update_state(true);
  }
}, null);

let homie_init = function () {
    publish(state_topic, 'init');
    publish(base_topic + '/$homie', '4.0.0');
    publish(base_topic + '/$name', 'Sonoff Basic openHAB (Homie Edition)');
    publish(base_topic + '/$extensions', '');
//    publish(base_topic + '/$extensions', 'org.homie.legacy-stats:0.1.1:[4.x]');
//    publish(stats_topic + '/interval', 0);	// OH2.4-friendly
    publish(base_topic + '/$nodes', 'switch');
    publish(base_topic + '/switch/$name', 'Switch');
    publish(base_topic + '/switch/$type', 'on/off');
    publish(base_topic + '/switch/$properties', 'state,oncount');
    publish(base_topic + '/switch/state/$name', 'Relay state');
    publish(base_topic + '/switch/state/$datatype', 'boolean');
    publish(base_topic + '/switch/state/$settable', 'true');
    publish(base_topic + '/switch/oncount/$name', 'Relay on time');
    publish(base_topic + '/switch/oncount/$datatype', 'integer');
    publish(state_topic, 'ready');
};

Log.print(Log.WARN, "### init script started ###");

