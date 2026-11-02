# Family Travel Business – Bezahlvorschau

Klickbarer Prototyp für die Vermittlungsplattform (Stripe Connect, Direct Charges).
Alle Daten sind Testdaten im Browser (localStorage), Zahlungen sind simuliert, kein Server, keine Stripe-Schlüssel.

Starten: `python3 -m http.server 4173 --bind 127.0.0.1`, dann http://localhost:4173

Abläufe: Entdecken → Angebot → Kasse (Testkarte 4242…, abgelehnt 4000 0000 0000 0002) → Aufteilung der Zahlung;
Mein Bereich (Einrichtungsgebühr, Identitätsprüfung, Angebote anlegen/bearbeiten/löschen, Verkäufe, Profil);
Verwaltung (Kennzahlen, Mitglieder freigeben/sperren, Provision und Gebühr, CSV-Export für DAC7).

Offen vor echtem Bau: Stripe-Konto der LLC (US-Bankkonto), Klärung Cross-Border Direct Charges mit Stripe, Steuerfragen (DAC7, Wohnsitz Dirk).
