#include <WiFi.h>
#include <WebServer.h>
#include <WiFiManager.h>  // Librería para gestión automática de AP y Credenciales
#include <OneWire.h>
#include <DallasTemperature.h>
#include <LittleFS.h>
#include <time.h>
#include <ESPmDNS.h>

// --- Configuración NTP oficial de Chile (SHOA) ---
const char* ntpServer = "shoa.ntp.cl";
const long  gmtOffset_sec = -10800;       // -3 horas (Chile continental estándar)
const int   daylightOffset_sec = 0;       

WebServer server(80);

// --- Pines del Hardware ---
const int ONE_WIRE_BUS = 4;    // Pin GPIO4 para la sonda DS18B20
const int PIN_LED_BLUE  = 16;  // GPIO16 (Azul)
const int PIN_LED_GREEN = 17;  // GPIO17 (Verde)
const int PIN_LED_RED   = 5;   // GPIO5  (Rojo)
const int PIN_BUZZER    = 19;  // GPIO19 (Buzzer Activo)

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

// Función para obtener la hora exacta desde shoa.ntp.cl
String obtenerMarcaDeTiempo() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "10-11-2026 15:00:00"; // Fallback por seguridad
  }
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%d-%m-%Y %H:%M:%S", &timeinfo);
  return String(buffer);
}

// Función para registrar datos en el archivo datos.txt de la memoria Flash (LittleFS)
void registrarDato(float temp, String estado) {
  File file = LittleFS.open("/datos.txt", FILE_APPEND);
  if (!file) {
    Serial.println("Error al abrir datos.txt para escritura");
    return;
  }
  
  String timestamp = obtenerMarcaDeTiempo();
  String linea = timestamp + "; " + String(temp, 1) + " ; " + estado + "\n";
  
  file.print(linea);
  file.close();
  Serial.println("Registro guardado: " + linea);
}

// --- Rutas del Servidor Web (Sirviendo desde LittleFS) ---
void handleRoot() {
  File file = LittleFS.open("/index.html", "r");
  if (!file) {
    server.send(404, "text/plain", "Error: Falta el archivo index.html en LittleFS.");
    return;
  }
  server.streamFile(file, "text/html");
  file.close();
}

void handleCss() {
  File file = LittleFS.open("/style.css", "r");
  server.streamFile(file, "text/css");
  file.close();
}

void handleJs() {
  File file = LittleFS.open("/app.js", "r");
  server.streamFile(file, "application/javascript");
  file.close();
}

void handleDatosTxt() {
  File file = LittleFS.open("/datos.txt", "r");
  if (!file) {
    server.send(404, "text/plain", "No hay datos registrados aún.");
    return;
  }
  server.streamFile(file, "text/plain");
  file.close();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  // Inicializar LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("Error al montar LittleFS");
    return;
  }
  Serial.println("LittleFS montado correctamente.");

  // Inicializar hardware
  sensors.begin();
  pinMode(PIN_LED_BLUE, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  
  digitalWrite(PIN_LED_BLUE, LOW);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_BUZZER, LOW);

  // --- WiFiManager (Portal Cautivo / Configuración Web) ---
  WiFiManager wm;
  Serial.println("Iniciando gestor de red Wi-Fi...");
  bool res = wm.autoConnect("SmartCooler-Config", "12345678");

  if(!res) {
    Serial.println("Fallo en la conexión o tiempo de espera agotado.");
  } else {
    Serial.println("¡Conectado a la red Wi-Fi con éxito!");
  }

  // --- Inicializar mDNS ---
  if (!MDNS.begin("smartcooler")) {
     Serial.println("Error al iniciar mDNS!");
  } else {
     Serial.println("¡mDNS configurado! Ya puedes entrar por: http://smartcooler.local");
  }

// --- Configurar Hora con SHOA + servidores de respaldo en Chile ---
  configTime(gmtOffset_sec, daylightOffset_sec, "shoa.ntp.cl", "0.cl.pool.ntp.org", "pool.ntp.org");
  Serial.print("Sincronizando hora");
  
  int intentos = 0;
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo) && intentos < 15) {
    delay(500);
    Serial.print(".");
    intentos++;
  }
  Serial.println("\nHora actual del sistema: " + obtenerMarcaDeTiempo());

  // --- Registrar Rutas del Servidor Web ---
  server.on("/", HTTP_GET, handleRoot);
  server.on("/style.css", HTTP_GET, handleCss);
  server.on("/app.js", HTTP_GET, handleJs);
  server.on("/datos.txt", HTTP_GET, handleDatosTxt);
  
  server.begin();
  Serial.println("Servidor HTTP interno iniciado. IP: " + WiFi.localIP().toString());
}

unsigned long ultimaLectura = 0;

void loop() {
  server.handleClient();

  // Tomar lectura y registrar datos cada 30 segundos
  if (millis() - ultimaLectura > 30000) {
    ultimaLectura = millis();

    sensors.requestTemperatures();
    float temperatura = sensors.getTempCByIndex(0);

    String estado = "normal";
    if (temperatura < 2.0) {
      estado = "advertencia";
      digitalWrite(PIN_LED_BLUE, HIGH);
      digitalWrite(PIN_LED_GREEN, LOW);
      digitalWrite(PIN_LED_RED, LOW);
      digitalWrite(PIN_BUZZER, LOW);
    } 
    else if (temperatura >= 2.0 && temperatura <= 8.0) {
      estado = "normal";
      digitalWrite(PIN_LED_BLUE, LOW);
      digitalWrite(PIN_LED_GREEN, HIGH);
      digitalWrite(PIN_LED_RED, LOW);
      digitalWrite(PIN_BUZZER, LOW);
    } 
    else {
      estado = "alerta";
      digitalWrite(PIN_LED_BLUE, LOW);
      digitalWrite(PIN_LED_GREEN, LOW);
      digitalWrite(PIN_LED_RED, HIGH);
      digitalWrite(PIN_BUZZER, HIGH); 
    }

    registrarDato(temperatura, estado);
  }
}