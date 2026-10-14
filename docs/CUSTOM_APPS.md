# Custom apps

Open **Add Custom App** from the app catalog to package an installer from a URL. Enter the publisher, app name, version, installer type and architecture. Generic EXE installers need the vendor documented silent switches.

## Saved definitions

Use **Save definition** to keep the reusable details for your account and selected tenant. This stores the app name, publisher, installer type, architecture, install scope, silent switches, uninstall command, description and optional icon URL. Saving does not add anything to the cart, start packaging or deploy an app.

Select **Deploy new version** beside a saved app to fill these details into the form. Enter the new version and installer URL, and optionally a trusted SHA256. Adding the app to the cart regenerates detection rules for that version. Review the cart and assignments before deploying as usual.

Installer URLs, versions and SHA256 values are not stored in definitions. If you use your own private storage, supply a read only signed URL with enough time for packaging to finish. Existing packaging jobs still retain their deployment configuration; a saved definition is not a credential vault. Prefer a trusted hash for installer verification.

**Update saved definition** replaces only the reusable metadata. **Delete** removes the definition and leaves existing packages and deployments unchanged.

Hosted installations use the application database. Self hosted SQLite installations store definitions in their configured database, with the same account and tenant separation. Keep that database in persistent storage. Definitions from another tenant are not shared automatically.

Direct file upload is not part of this feature. Continue using an installer URL; there is no new binary storage service or automatic custom app update detection.
