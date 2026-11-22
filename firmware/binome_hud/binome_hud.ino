// PNR - binome HUD (STM32 Blue Pill / Nucleo, STM32duino core).
//
// A rotary potentiometer stands for the ARI air-cylinder valve (0-300 bar), an IR obstacle sensor is the touchless MAYDAY, and an
// optional 16x2 I2C LCD shows the verdict. USB serial at 115200 baud, newline-terminated JSON.
//
//   to the browser, every 400 ms:   {"seq": 101, "t_ms": 184000, "source": "binome-hud", "sensor": "ari_bar", "value": 145.0, "unit": "bar", "room": "binome-1"}
//   to the browser, when triggered: {"seq": 102, "t_ms": 184120, "source": "binome-hud", "sensor": "mayday", "value": 1, "unit": "bool", "room": "binome-1"}
//   from the browser:               {"cmd":"alert","level":"NO-GO"}   or   {"cmd":"alert","level":"GO"}
//
// Wiring (see firmware/README.md): potentiometer left lug -> 3V3, wiper -> PA0 (A0), right lug -> GND; MH-B IR sensor VCC -> 3V3,
// GND -> GND, OUT -> PA1 (A1, active low); LCD backpack GND -> GND, VCC -> 5V, SDA and SCL on the board's default I2C pins: PB7 / PB6
// on a Blue Pill, D14 / D15 (= PB9 / PB8) on a Nucleo-64 (optional: nothing blocks if it is absent).
//
// Board menu (Arduino IDE, STM32duino): "USB support: CDC (generic 'Serial' supersede U(S)ART)" on a Blue Pill; on a Nucleo `Serial`
// is the ST-Link virtual COM port. Library for the LCD: "LiquidCrystal_I2C".

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

static const uint32_t BAUD = 115200;
static const uint32_t ARI_MS = 400;         // pressure packet interval
static const uint16_t ADC_MAX = 1023;       // 10-bit reading
static const float BAR_MAX = 300.0f;        // full scale of the cylinder gauge
#define PIN_ARI PA0                         // potentiometer wiper (analog input)
#define PIN_MAYDAY PA1                      // MH-B: LOW when a hand is within about 5 cm
static const uint32_t MAYDAY_CONFIRM_MS = 30;    // the sensor must stay triggered this long: no flicker
static const uint32_t MAYDAY_REARM_MS = 1000;    // and read clear this long before it can trigger again
static const uint8_t ADC_SAMPLES = 8;       // averaged: the potentiometer jitters

enum Alert { ALERT_GO, ALERT_NOGO };
Alert alertLevel = ALERT_GO;
bool maydaySent = false;
// Armed only after the sensor has read clear for MAYDAY_REARM_MS: no MAYDAY at power-up (bench, 22/11: the MH-B output was low
// while it started, and a MAYDAY went out 82 ms after boot, which the app would latch as a NO-GO).
bool maydayArmed = false;

LiquidCrystal_I2C *lcd = nullptr;  // created only if a screen answers
uint32_t seq = 100;
uint32_t lastAriMs = 0;
float lastBar = 0.0f;
uint32_t maydayLowSince = 0;
uint32_t maydayHighSince = 0;
bool screenDirty = true;

char line[96];
uint8_t lineLen = 0;

// An I2C device answers at this address?
bool present(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

// A value with one decimal, written by hand: float printf is not compiled into every STM32 C library.
void tenths(char *out, size_t n, float value) {
  if (value < 0.0f) value = 0.0f;
  const int t = (int)(value * 10.0f + 0.5f);
  snprintf(out, n, "%d.%d", t / 10, t % 10);
}

// One packet, exactly the wire format of the specification. `valueText` is already a JSON number.
void emit(const char *sensor, const char *valueText, const char *unit) {
  char buf[160];
  snprintf(buf, sizeof(buf), "{\"seq\": %lu, \"t_ms\": %lu, \"source\": \"binome-hud\", \"sensor\": \"%s\", \"value\": %s, \"unit\": \"%s\", \"room\": \"binome-1\"}\n",
           (unsigned long)seq++, (unsigned long)millis(), sensor, valueText, unit);
  Serial.print(buf);
}

float readBar() {
  uint32_t sum = 0;
  for (uint8_t i = 0; i < ADC_SAMPLES; i++) sum += analogRead(PIN_ARI);
  const float raw = (float)sum / ADC_SAMPLES;
  return raw * BAR_MAX / ADC_MAX;  // 0..1023 -> 0..300 bar, linear
}

void drawScreen() {
  if (!lcd) return;
  lcd->setCursor(0, 0);
  lcd->print(alertLevel == ALERT_NOGO ? "!!! NO-GO !!!   " : "PNR   GO        ");
  lcd->setCursor(0, 1);
  char buf[28];  // room for the whole format: no truncation warning
  snprintf(buf, sizeof(buf), "AIR %3d bar %s    ", (int)(lastBar + 0.5f), maydaySent ? "SOS" : "   ");
  buf[16] = 0;   // the screen has 16 columns
  lcd->print(buf);
}

// {"cmd":"alert","level":"NO-GO"} or {"cmd":"alert","level":"GO"}: spaces ignored, no JSON library needed.
void handleLine(const char *raw) {
  char flat[96];
  uint8_t n = 0;
  for (const char *p = raw; *p && n < sizeof(flat) - 1; p++)
    if (*p != ' ' && *p != '\r') flat[n++] = *p;
  flat[n] = 0;
  if (!strstr(flat, "\"cmd\":\"alert\"")) return;  // boot text, anything else: ignored
  // "NO-GO" contains "GO": test it first.
  if (strstr(flat, "\"level\":\"NO-GO\"")) alertLevel = ALERT_NOGO;
  else if (strstr(flat, "\"level\":\"GO\"")) alertLevel = ALERT_GO;
  else return;
  screenDirty = true;
}

void readHost() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n') {
      line[lineLen] = 0;
      handleLine(line);
      lineLen = 0;
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    } else {
      lineLen = 0;  // an over-long line is noise: drop it
    }
  }
}

void setup() {
  Serial.begin(BAUD);
  analogReadResolution(10);
  pinMode(PIN_ARI, INPUT_ANALOG);
  pinMode(PIN_MAYDAY, INPUT);
  Wire.begin();
  // The screen is optional: 0x27 first, 0x3F as the fallback, nothing if neither answers.
  const uint8_t addr = present(0x27) ? 0x27 : present(0x3F) ? 0x3F : 0;
  if (addr) {
    lcd = new LiquidCrystal_I2C(addr, 16, 2);
    lcd->init();
    lcd->backlight();
  }
}

void loop() {
  const uint32_t now = millis();
  readHost();

  // MAYDAY: triggered once per wave of the hand, emitted at once.
  const bool triggered = digitalRead(PIN_MAYDAY) == LOW;
  if (triggered) {
    maydayHighSince = 0;
    if (maydayLowSince == 0) maydayLowSince = now;
    if (maydayArmed && !maydaySent && now - maydayLowSince >= MAYDAY_CONFIRM_MS) {
      emit("mayday", "1", "bool");
      maydaySent = true;
      screenDirty = true;
    }
  } else {
    maydayLowSince = 0;
    if (maydayHighSince == 0) maydayHighSince = now;
    if (now - maydayHighSince >= MAYDAY_REARM_MS) {
      maydaySent = false;
      maydayArmed = true;
    }
  }

  if (now - lastAriMs >= ARI_MS) {
    lastAriMs = now;
    lastBar = readBar();
    char text[12];
    tenths(text, sizeof(text), lastBar);
    emit("ari_bar", text, "bar");
    screenDirty = true;
  }

  if (screenDirty) {
    drawScreen();
    screenDirty = false;
  }
}
