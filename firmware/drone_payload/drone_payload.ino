// PNR - drone payload (ESP32 DevKit).
//
// GY-BMP280 (pressure + temperature) on I2C at 3.3 V, and a roller-lever microswitch ("crash sensor") that selects the room the
// drone says it is in. Every 500 ms it writes two JSON lines to the USB serial port at 115200 baud, newline-terminated:
//
//   {"seq": 42, "t_ms": 183500, "source": "drone-payload", "sensor": "temp_bmp280", "value": 54.20, "unit": "C", "room": "stockage-solvants"}
//   {"seq": 43, "t_ms": 183500, "source": "drone-payload", "sensor": "alt_bmp280", "value": 0.35, "unit": "m", "room": "stockage-solvants"}
//
// Wiring (see firmware/README.md): BMP280 VCC -> 3V3 (never 5V), GND -> GND, SCL -> GPIO22, SDA -> GPIO21, CSB and SDO unconnected;
// microswitch VCC -> 3V3, GND -> GND, OUT -> GPIO4 (INPUT_PULLUP, a falling edge advances the room).
//
// The sketch never invents a reading: with no sensor it prints a plain-text notice (the app ignores anything that is not a
// JSON packet) and sends no value.
//
// Library: "Adafruit BMP280 Library" (and its Adafruit Unified Sensor dependency).

#include <Wire.h>
#include <Adafruit_BMP280.h>

static const uint32_t BAUD = 115200;
static const uint32_t LOOP_MS = 500;       // one cycle: a temperature line and an altitude line
static const uint32_t DEBOUNCE_MS = 200;
static const uint8_t PIN_SWITCH = 4;       // GPIO 4, INPUT_PULLUP
static const uint8_t PIN_SDA = 21;
static const uint8_t PIN_SCL = 22;

// The rooms the operator cycles through. The app maps these names to the rooms of its site plan.
static const char *const ROOMS[] = {"sas-entree", "atelier", "stockage-solvants"};
static const uint8_t ROOM_COUNT = sizeof(ROOMS) / sizeof(ROOMS[0]);

Adafruit_BMP280 bmp;  // I2C
bool bmpOk = false;
float basePressureHpa = 1013.25f;  // replaced at start-up: altitude is relative to where the payload was switched on
uint8_t roomIndex = 0;
uint32_t seq = 0;
uint32_t lastCycleMs = 0;
uint32_t lastPressMs = 0;
bool lastLevel = HIGH;

// One packet, exactly the wire format of the specification.
void emit(const char *sensor, float value, const char *unit) {
  if (isnan(value)) return;  // never send a reading that is not one
  Serial.printf("{\"seq\": %lu, \"t_ms\": %lu, \"source\": \"drone-payload\", \"sensor\": \"%s\", \"value\": %.2f, \"unit\": \"%s\", \"room\": \"%s\"}\n",
                (unsigned long)seq++, (unsigned long)millis(), sensor, value, unit, ROOMS[roomIndex]);
}

void setup() {
  Serial.begin(BAUD);
  // The boot ROM leaves a stray byte on the line: without this newline the first packet arrives glued to it and the app drops it
  // (bench, 22/11: seq 0 lost after every reset).
  Serial.println();
  pinMode(PIN_SWITCH, INPUT_PULLUP);
  Wire.begin(PIN_SDA, PIN_SCL);
  // The GY-BMP280 answers at 0x76 (SDO unconnected) or 0x77.
  bmpOk = bmp.begin(0x76) || bmp.begin(0x77);
  if (bmpOk) {
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL, Adafruit_BMP280::SAMPLING_X2, Adafruit_BMP280::SAMPLING_X16,
                    Adafruit_BMP280::FILTER_X16, Adafruit_BMP280::STANDBY_MS_500);
    delay(150);
    basePressureHpa = bmp.readPressure() / 100.0F;
  }
}

void loop() {
  const uint32_t now = millis();

  // The microswitch: a debounced falling edge moves to the next room.
  const bool level = digitalRead(PIN_SWITCH);
  if (lastLevel == HIGH && level == LOW && now - lastPressMs >= DEBOUNCE_MS) {
    roomIndex = (roomIndex + 1) % ROOM_COUNT;
    lastPressMs = now;
  }
  lastLevel = level;

  if (now - lastCycleMs >= LOOP_MS) {
    lastCycleMs = now;
    if (bmpOk) {
      emit("temp_bmp280", bmp.readTemperature(), "C");
      emit("alt_bmp280", bmp.readAltitude(basePressureHpa), "m");
    } else {
      Serial.println("BMP280 introuvable (I2C 0x76 / 0x77) : verifier le cablage 3V3, GND, SDA=21, SCL=22");
    }
  }
}
