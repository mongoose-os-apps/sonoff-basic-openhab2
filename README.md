## A Sonoff Basic firmware to work with openHAB 2.4+

This firmware drives Sonoff Basic from [iTead Studio](https://www.itead.cc/),
powered by [Mongoose OS](https://mongoose-os.com/).
It targets to work with openHAB2 v2.4 and later using the new v2 MQTT binding.

If you happen to use or like the 1.x version MQTT binding, see
[this example](https://github.com/mongoose-os-apps/sonoff-basic-openhab) instead,
 hereby referred to as "the original example" and from which,
the sharp reader will grasp, this one evolved.

### Features

This code implements [Homie Convention](https://homieiot.github.io/) 4.0.0 and so the device announces as a switch
 with an extra read-only attribute to get the time it spent in the on state, as provided by
 the original example.

The uptime and freeRAM info has been moved to the $stats property provided by the legacy-stats extension.
It has been commented out, so remove the comments if you want it.
The rest is basically the same as in [the original example](https://github.com/mongoose-os-apps/sonoff-basic-openhab)

### Build

The definitions in mos.yml allow you to just:

	mos build

### Flash

Sonoff Basic has only 1Mbytes flash.

	mos flash --esp-flash-params "dout,8m,40m"

### Configuration

There is no need for configuration, the device generates an id based on its MAC address.
The autodiscovery procedure will do the rest.

The only thing you have to configure is your wifi network, and you don't need to know your device
IP address, if you have zillions of devices just plug them in one by one and you are all set.

### MQTT setup

You do need an MQTT broker with persistence capability. The author used [Mosquitto]().

As we are using the Homie Convention and that requires messages to be retained for proper
operation, do configure your broker for "persistence" capability.
In Mosquitto, that is just adding it somewhere in the config file (search for it): 

	persistence true

and probably also adding the name and location for the persistent database:

	persistence_file mosquitto.db
	persistence_location /var/lib/mosquitto/

which in your distribution might happen to be the default and have been compiled for that
and so you don't need to do anything regarding that. Check your config file and your setup.
If you do change this, the broker user name (usually mosquitto) must have write capability.

### Setup at openHAB side

Your broker can be added via the Paper UI, please make sure 'retain' is true when you do it.

Once your device starts, it will show up in your inbox.
Once your thing is added you'll see two channels, one for the 'Relay state' and one for the 'Relay on time'.
From now on you can click your way at will; link these channels to a switch and number object, for example.
But if you want to go old school and do some text setup, keep reading.

Add the channel ids to items; for example:

```
Switch Bedroom_Lights_Switch {channel="mqtt:homie300:3d8f9921:ohsb4bbc08:switch#state"}
Number Bedroom_Lights_Switch_OnCount {channel="mqtt:homie300:3d8f9921:ohsb4bbc08:switch#oncount"}
```

Here, *3df89921* is the Mosquitto broker id in this system, it will be different for you.

Here too, *ohsb4bbc08* is the id for a device in this house, it will also be different for you.

Also add some entries to your sitemap:

```
	Frame label="Bedroom" {
		Switch item=Bedroom_Lights_Switch label="Light Switch" icon="light"
		Text item=Bedroom_Lights_Switch_OnCount label="latest ON Time [%.0f s]" icon="line-stagnation"
	}
```

The on count is reset every time, it is shown here as in idea on how to read this property. To make actual
use of it and (for example) keep the count in order to display a usage graph, you may want to see
[the original example](https://github.com/mongoose-os-apps/sonoff-basic-openhab).

#### Device Health

The object health is maintained by openHAB and the Homie convention, via the last will service in MQTT.

When the device gets disconnected, the broker publishes a last will message on its behalf, that instructs openHAB to label the device as offline.

### Extra goodies
Do check [the original example](https://github.com/mongoose-os-apps/sonoff-basic-openhab), there is a built-in parser (which this example carries along) to read on/off times from a JSON file and work autonomously (without openHAB or any other home automation engine).