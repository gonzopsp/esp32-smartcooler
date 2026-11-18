#include <WiFi.h>
#include <WebServer.h>
#include <WiFiManager.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <time.h>
#include <ESPmDNS.h>

// --- Configuración NTP (SHOA + respaldos en Chile) ---
const char* ntpServer1 = "shoa.ntp.cl";
const char* ntpServer2 = "0.cl.pool.ntp.org";
const char* ntpServer3 = "pool.ntp.org";
const long  gmtOffset_sec = -10800; // -3 horas (Chile continental)
const int   daylightOffset_sec = 0;

WebServer server(80);
Preferences prefs;

// --- Pines del Hardware ---
const int ONE_WIRE_BUS  = 4;   // GPIO4: Sonda DS18B20
const int PIN_LED_BLUE  = 16;  // GPIO16: LED Azul
const int PIN_LED_GREEN = 17;  // GPIO17: LED Verde
const int PIN_LED_RED   = 5;   // GPIO5:  LED Rojo
const int PIN_BUZZER    = 19;  // GPIO19: Buzzer Activo

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

// --- Parámetros Configurables (valores por defecto según Etapa 2 y 3) ---
float tempMin = 2.0;
float tempMax = 8.0;
unsigned long intervaloSeg = 5;       // Lectura cada 5 segundos
unsigned long retardoAlertaSeg = 30;  // 30 segundos continuos > tempMax para gatillar alerta

// --- Variables de Estado ---
String estadoActual = "normal";
unsigned long inicioExcursionMs = 0;
unsigned long ultimaLecturaMs = 0;
unsigned long ultimoToggleBuzzerMs = 0;
bool estadoBuzzer = false;

void cargarConfiguracion() {
  prefs.begin("smartcooler", true);
  tempMin = prefs.getFloat("tempMin", 2.0);
  tempMax = prefs.getFloat("tempMax", 8.0);
  intervaloSeg = prefs.getULong("intervalo", 5);
  retardoAlertaSeg = prefs.getULong("retardo", 30);
  prefs.end();
}

void guardarConfiguracion() {
  prefs.begin("smartcooler", false);
  prefs.putFloat("tempMin", tempMin);
  prefs.putFloat("tempMax", tempMax);
  prefs.putULong("intervalo", intervaloSeg);
  prefs.putULong("retardo", retardoAlertaSeg);
  prefs.end();
}

String obtenerMarcaDeTiempo() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "18-11-2026 00:00:00";
  }
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%d-%m-%Y %H:%M:%S", &timeinfo);
  return String(buffer);
}

void registrarDato(float temp, String estado) {
  // Evitar saturar la Flash si el archivo supera 150 KB
  if (LittleFS.exists("/datos.txt")) {
    File check = LittleFS.open("/datos.txt", "r");
    if (check && check.size() > 153600) {
      check.close();
      LittleFS.remove("/datos.txt");
    } else if (check) {
      check.close();
    }
  }

  File file = LittleFS.open("/datos.txt", FILE_APPEND);
  if (!file) {
    Serial.println("Error al abrir datos.txt");
    return;
  }

  String timestamp = obtenerMarcaDeTiempo();
  String linea = timestamp + "; " + String(temp, 1) + " ; " + estado + "\n";
  file.print(linea);
  file.close();
  Serial.println("Registro: " + linea);
}

// --- Control no bloqueante del Buzzer según estado ---
void actualizarBuzzer() {
  unsigned long ahora = millis();

  if (estadoActual == "alerta") {
    // Intermitente rápido (300 ms ON / 300 ms OFF)
    if (ahora - ultimoToggleBuzzerMs >= 300) {
      ultimoToggleBuzzerMs = ahora;
      estadoBuzzer = !estadoBuzzer;
      digitalWrite(PIN_BUZZER, estadoBuzzer ? HIGH : LOW);
    }
  } else if (estadoActual == "advertencia") {
    // Intermitente lento (250 ms ON / 1750 ms OFF)
    unsigned long intervalo = estadoBuzzer ? 250 : 1750;
    if (ahora - ultimoToggleBuzzerMs >= intervalo) {
      ultimoToggleBuzzerMs = ahora;
      estadoBuzzer = !estadoBuzzer;
      digitalWrite(PIN_BUZZER, estadoBuzzer ? HIGH : LOW);
    }
  } else if (estadoActual == "ERROR_SENSOR") {
    // Pulso medio de falla de hardware (500 ms ON / 500 ms OFF)
    if (ahora - ultimoToggleBuzzerMs >= 500) {
      ultimoToggleBuzzerMs = ahora;
      estadoBuzzer = !estadoBuzzer;
      digitalWrite(PIN_BUZZER, estadoBuzzer ? HIGH : LOW);
    }
  } else {
    // Normal o pre-alerta: silencio
    estadoBuzzer = false;
    digitalWrite(PIN_BUZZER, LOW);
  }
}

void setLeds(bool r, bool g, bool b) {
  digitalWrite(PIN_LED_RED, r ? HIGH : LOW);
  digitalWrite(PIN_LED_GREEN, g ? HIGH : LOW);
  digitalWrite(PIN_LED_BLUE, b ? HIGH : LOW);
}

// --- Rutas del Servidor Web ---
void handleRoot() {
  File file = LittleFS.open("/index.html", "r");
  if (!file) {
    server.send(404, "text/plain", "Falta index.html en LittleFS");
    return;
  }
  server.streamFile(file, "text/html");
  file.close();
}

void handleCss() {
  File file = LittleFS.open("/style.css", "r");
  if (!file) { server.send(404, "text/plain", ""); return; }
  server.streamFile(file, "text/css");
  file.close();
}

void handleJs() {
  File file = LittleFS.open("/app.js", "r");
  if (!file) { server.send(404, "text/plain", ""); return; }
  server.streamFile(file, "application/javascript");
  file.close();
}

void handleDatosTxt() {
  if (!LittleFS.exists("/datos.txt")) {
    server.send(200, "text/plain", "");
    return;
  }
  File file = LittleFS.open("/datos.txt", "r");
  server.streamFile(file, "text/plain");
  file.close();
}

void handleGetConfig() {
  String json = "{";
  json += "\"min\":" + String(tempMin, 1) + ",";
  json += "\"max\":" + String(tempMax, 1) + ",";
  json += "\"intervalo\":" + String(intervaloSeg) + ",";
  json += "\"retardo\":" + String(retardoAlertaSeg);
  json += "}";
  server.send(200, "application/json", json);
}

void handlePostConfig() {
  if (server.hasArg("min") && server.hasArg("max")) {
    float nuevoMin = server.arg("min").toFloat();
    float nuevoMax = server.arg("max").toFloat();
    long nuevoInt = server.hasArg("intervalo") ? server.arg("intervalo").toInt() : intervaloSeg;
    long nuevoRet = server.hasArg("retardo") ? server.arg("retardo").toInt() : retardoAlertaSeg;

    if (nuevoMin >= nuevoMax || nuevoInt < 1 || nuevoRet < 0) {
      server.send(400, "text/plain", "Parametros invalidos");
      return;
    }

    tempMin = nuevoMin;
    tempMax = nuevoMax;
    intervaloSeg = (unsigned long)nuevoInt;
    retardoAlertaSeg = (unsigned long)nuevoRet;
    inicioExcursionMs = 0; // Reiniciar conteo de excursión tras cambio
    guardarConfiguracion();

    Serial.printf("Config actualizada -> Min: %.1f, Max: %.1f, Int: %lus, Retardo: %lus\n",
                  tempMin, tempMax, intervaloSeg, retardoAlertaSeg);
    server.send(200, "text/plain", "OK");
  } else {
    server.send(400, "text/plain", "Faltan argumentos");
  }
}

void handleLimpiarDatos() {
  File file = LittleFS.open("/datos.txt", FILE_WRITE);
  if (file) {
    file.print("");
    file.close();
  }
  inicioExcursionMs = 0;
  Serial.println("Historial datos.txt limpiado desde la web.");
  server.send(200, "text/plain", "OK");
}

void setup() {
  Serial.begin(115200);
  delay(300);

  if (!LittleFS.begin(true)) {
    Serial.println("Error al montar LittleFS");
    return;
  }

  cargarConfiguracion();

  sensors.begin();
  pinMode(PIN_LED_BLUE, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  setLeds(false, false, false);
  digitalWrite(PIN_BUZZER, LOW);

  WiFiManager wm;
  wm.setConnectTimeout(15);
  bool res = wm.autoConnect("SmartCooler-Config", "12345678");
  if (res) {
    Serial.println("Wi-Fi conectado. IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("Modo autonomo sin Wi-Fi.");
  }

  if (MDNS.begin("smartcooler")) {
    Serial.println("mDNS activo: http://smartcooler.local");
  }

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer1, ntpServer2, ntpServer3);
  struct tm timeinfo;
  int intentos = 0;
  while (!getLocalTime(&timeinfo) && intentos < 12) {
    delay(400);
    intentos++;
  }
  Serial.println("Hora sincronizada: " + obtenerMarcaDeTiempo());

  server.on("/", HTTP_GET, handleRoot);
  server.on("/style.css", HTTP_GET, handleCss);
  server.on("/app.js", HTTP_GET, handleJs);
  server.on("/datos.txt", HTTP_GET, handleDatosTxt);
  server.on("/config", HTTP_GET, handleGetConfig);
  server.on("/config", HTTP_POST, handlePostConfig);
  server.on("/limpiar", HTTP_POST, handleLimpiarDatos);

  server.begin();
}

void loop() {
  server.handleClient();
  actualizarBuzzer();

  unsigned long ahora = millis();
  if (ahora - ultimaLecturaMs >= (intervaloSeg * 1000UL)) {
    ultimaLecturaMs = ahora;

    sensors.requestTemperatures();
    float temperatura = sensors.getTempCByIndex(0);

    // 1. Validar desconexión de hardware (Prueba P5)
    if (temperatura == DEVICE_DISCONNECTED_C || temperatura < -100.0) {
      estadoActual = "ERROR_SENSOR";
      inicioExcursionMs = 0;
      setLeds(true, false, true); // Magenta (Rojo + Azul) indica falla de sonda
      registrarDato(-127.0, estadoActual);
      return;
    }

    // 2. Evaluar rangos térmicos y retardo continuo (Pruebas P2, P3, P4)
    if (temperatura > tempMax) {
      if (inicioExcursionMs == 0) {
        inicioExcursionMs = ahora;
      }
      unsigned long segundosSobre = (ahora - inicioExcursionMs) / 1000UL;

      if (segundosSobre >= retardoAlertaSeg) {
        estadoActual = "alerta";
        setLeds(true, false, false); // Rojo fijo
      } else {
        estadoActual = "pre-alerta";
        setLeds(true, true, false);  // Amarillo (Rojo + Verde): fuera de rango esperando umbral de tiempo
      }
    } 
    else if (temperatura < tempMin) {
      inicioExcursionMs = 0;
      estadoActual = "advertencia";
      setLeds(false, false, true);   // Azul: riesgo de congelación
    } 
    else {
      inicioExcursionMs = 0;
      estadoActual = "normal";
      setLeds(false, true, false);   // Verde: rango seguro
    }

    registrarDato(temperatura, estadoActual);
  }
}