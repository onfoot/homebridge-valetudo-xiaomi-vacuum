# homebridge-valetudo-xiaomi-vacuum

`homebridge-valetudo-xiaomi-vacuum` is a [Homebridge](https://github.com/nfarina/homebridge) plugin which you can use to control your Xiaomi Roborock vacuum that has [Valetudo](https://github.com/Hypfer/Valetudo) installed.

This is a work in progress, but shouldn't blow up your robot.

## Installation

`npm -g install homebridge-valetudo-xiaomi-vacuum`

## Configuration

An entry in `config.json` is needed

```
{
    "accessory": "ValetudoXiaomiVacuum",
    "name": "<optional, Vacuum by default>",
    "ip": "<vacuum ip address>"
}
```

## Compatibility

Tested on Roborock S50 with Valetudo 0.3.1 and v001748.
