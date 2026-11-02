# Bezahlvorschau Family Travel Business

Ziel: Dirk Adams zeigen, wie das Vermittlermodell mit Stripe Connect (Direct Charges) für Kunden, Mitglieder und Betreiber aussieht, bevor die LLC ein Stripe-Konto hat. Statische Seite, Stripe nur simuliert, live auf GitHub Pages.

## Stand (02.11.2026)

- Entdecken, Angebot, Kasse mit Testkarten, Aufteilung der Zahlung
- Mein Bereich: Einrichtungsgebühr, Verifizierung (Nachbau des Stripe-Ablaufs inkl. Adressnachweis), Angebote anlegen/bearbeiten/löschen, Verkäufe, Profil
- Verwaltung: Kennzahlen, Mitglieder freigeben/sperren, Provision/Gebühr, CSV-Export
- Anleitung „So verkaufst du“
- Tests: `node tests/check.mjs` (Speicher, Escaping, Verifizierung, CSP-Hash)

## Threat Model (Vorschau)

**Angreifer-Szenarien**
- Fremde Seite unter `klassenmedia.github.io` schreibt präparierte Daten in den gemeinsamen localStorage (gleicher Origin), um Skript einzuschleusen.
- Besucher hält die öffentliche Vorschau für echt und tippt echte Ausweis-, Bank- oder Kartendaten ein.
- Besucher manipuliert in den DevTools `data-id` oder den URL-Hash, um Abläufe zu überspringen.

**Untrusted Inputs und Gegenmaßnahme**
| Input | Gegenmaßnahme |
|---|---|
| localStorage `ftb-vorschau-v1` | `isValidState` prüft Struktur, IDs, Zahlen, Datumswerte; sonst Testdaten |
| Formularfelder (Angebot, Profil, Kasse, Verifizierung) | `escapeHtml` vor jedem `innerHTML`, Längenbegrenzung, Wertebereiche |
| URL-Hash | Routen per `Object.hasOwn`, unbekannte IDs → „Seite gibt es nicht“ |
| `data-id` in Aktionen | Allowlists (`SAMPLE_FIELDS`, `SELLER_KINDS`, `DOC_TYPES`), Verifizierung an `memberId` gebunden |
| Kartennummer | nur die zwei Testkarten werden angenommen |

**Worst Case:** Ein Besucher gibt echte Daten ein. Abgemildert: keine Speicherung der Verifizierungsdaten, kein Netzwerkzugriff (CSP `default-src 'none'`, `form-action 'none'`), kein Datei-Upload, Hinweise „keine echten Daten“ bei Person, Bank, Kasse, Testmodus-Banner.

## Bewusst akzeptiert (nur Vorschau)

- Doppelbuchung bei Wegnavigieren während der Zahlung, Preisänderung während der Zahlung
- Gemeinsamer Origin `klassenmedia.github.io` (eigene Subdomain erst für den echten Bau)
- Review 02.11.: setupPaid-Prüfung im Timeout und Submit-Absicherung ohne eigenen Test; „Testdaten zurücksetzen“ verwirft laufende Verifizierung nicht (`verification = null` im Reset ergänzen)

## Offen vor dem echten Bau

- Stripe-Konto der LLC (US-Bankkonto, Wohnadresse Dirk), Cross-Border Direct Charges mit Stripe klären
- DAC7-Registrierung in einem EU-Staat, Steuer-Wohnsitz Dirk, Pauschalreise/Sicherungsschein bei Reise-Angeboten
- Freigabe- und Zahlungslogik serverseitig; Stripe-Webhooks mit Signaturprüfung; CoachKraft-Connect-Plan als Vorlage
