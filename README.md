# homebridge-valetudo-xiaomi-vacuum

`homebridge-valetudo-xiaomi-vacuum` is a [Homebridge](https://github.com/nfarina/homebridge) plugin which you can use to control your Xiaomi Roborock vacuum that has [Valetudo](https://github.com/Hypfer/Valetudo) installed.

## Installation

`npm -g install homebridge-valetudo-xiaomi-vacuum`

## Configuration

An entry in `config.json` is needed.

Example:

```
{
    "accessory": "ValetudoXiaomiVacuum",
    "name": "<Accessory name, e.g. Vacuum>",
    "ip": "<Vacuum's ip address>"
}
```

Optionally, you can enable switches for controlling speed modes of the device by adding the `power-control` dictionary with `default-speed` and `high-speed` keys (both mandatory in that case), where the speed preset may be one of: `quiet`, `balanced`, `turbo`, and `max`.

For a mopping-capable vacuum (i.e. Gen 2 - S50/S55), a mop mode button can be also enabled using the `mop-enabled` option that is a `true`/`false` value. You can skip that option altogether - `false` will be the default.

Example:

```
{
    "accessory": "ValetudoXiaomiVacuum",
    "name": "Mo",
    "ip": "192.00.486.259",
    "power-control": {
        "default-speed": "quiet",
        "high-speed": "turbo",
        "mop-enabled": true
    }
}
```

## Valetudo RE

If running your vacuum using Valetudo RE, `legacy-mode` needs to be set to `true`.

Example:

```
{
    "accessory": "ValetudoXiaomiVacuum",
    "name": "<Accessory name, e.g. Vacuum>",
    "ip": "<Vacuum's ip address>",
    "legacy-mode": true
}
```

## Compatibility

Tested on Roborock S50 with firmware v001748 and Valetudo 0.6.1.

## Vacuum map in Home app

I played a little with an idea of setting up a HomeKit camera that grabs the generated Vacuum image and streams it as a video.

Here's how to achieve it:

1. An mqtt broker running on a home server. [hmq](https://github.com/fhmq/hmq) in my case.
2. Vacuum set up to connect to said mqtt broker.
3. [I can't believe it's valetudo](https://github.com/Hypfer/ICantBelieveItsNotValetudo) running on the camera server, with webserver enabled, running on port 3030.
4. [homebridge-camera-ffmpeg](https://www.npmjs.com/package/homebridge-camera-ffmpeg) installed on the camera server's homebridge, properly configured.
5. Camera added to Home.

`homebridge-camera-ffmpeg` config:

```
{
      "name": "Vacuum",
      "videoConfig": {
        "source": "-loop 1 -i http://localhost:3030/api/map/image",
        "videoFilter": "pad='ih*16/9:ih:(ow-iw)/2:(oh-ih)/2',scale=1920:1080",
        "maxFPS": 5
      }
}
```

- `-loop 1` sets up ffmpeg so it's constantly loading the generated png for each frame
- `pad` filter is set up so it expands the generated png to an 16:9 aspect ratio image so it looks right in Home app, then it's scaled using `scale` down to 1920x1080
- `maxFPS` set to a reasonable value; at `1` it was having hard time to start live streaming in Home app; at `5` it's instantaneous

Looks cool!
