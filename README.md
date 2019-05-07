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

## Compatibility

Tested on Roborock S50 with firmware v001748 and Valetudo 0.3.1.
