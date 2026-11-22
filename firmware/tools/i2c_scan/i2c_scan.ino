// Bench diagnostic for the binome HUD (firmware/README.md §7): where does the LCD's I2C backpack answer?
// Scans both pin pairs a Nucleo-F446RE user might have used, and reports which lines are pulled up
// (the backpack has pull-ups to 5 V; an unconnected pin with the internal pull-down reads 0).
#include <Wire.h>

void scan(const char *label, uint32_t sda, uint32_t scl) {
  Wire.setSDA(sda);
  Wire.setSCL(scl);
  Wire.begin();
  Serial.print("SCAN ");
  Serial.print(label);
  Serial.print(":");
  int n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.print(" 0x");
      if (a < 16) Serial.print("0");
      Serial.print(a, HEX);
      n++;
    }
  }
  if (n == 0) Serial.print(" none");
  Serial.println();
  Wire.end();
}

void level(const char *name, uint32_t pin) {
  pinMode(pin, INPUT_PULLDOWN);
  delay(2);
  Serial.print(name);
  Serial.print("=");
  Serial.print(digitalRead(pin));
  Serial.print(" ");
}

void setup() {
  Serial.begin(115200);
  delay(300);
}

void loop() {
  scan("D14/D15 (SDA PB9, SCL PB8)", PB9, PB8);
  scan("PB7/PB6 (SDA PB7, SCL PB6)", PB7, PB6);
  Serial.print("PULLED-UP? ");
  level("PB9", PB9);
  level("PB8", PB8);
  level("PB7", PB7);
  level("PB6", PB6);
  Serial.println();
  delay(1500);
}
