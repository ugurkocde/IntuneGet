# IntuneGet Packager 1.4.2

This update brings configurable proxy routing and packaging tool integrity checks to the local Windows packager. It includes the storage and utility dependency updates merged since 1.4.1.

## Proxy support

`HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` configure the packager's Node request paths, including polling, client credential authentication, Microsoft Graph, installer downloads and Azure block uploads. TLS certificate validation remains enabled. Restart the service after changing its environment. `HTTPS_PROXY` covers HTTPS destinations, including most packager traffic. `HTTP_PROXY` covers plain HTTP destinations. These settings are independent; set both when both destination types need a proxy.

Lowercase proxy variables take precedence when nonempty. `NO_PROXY` supports hostnames, optional ports and `*`; CIDR ranges and Negotiate or Kerberos proxy authentication are not supported. Managed identity retains its existing Azure SDK credential path.

## Packaging tool integrity

Setup and packaging jobs verify IntuneWinAppUtil and the extracted PSAppDeployToolkit cache against the existing release pins. Downloads are checked before reaching their final file name. A changed executable, modified or incomplete toolkit, unexpected file or unsafe archive path stops packaging. The executable copy used by each job is checked again immediately before launch.

Tool versions and expected hashes are unchanged. A mismatch does not authorize substituting a different hash or disabling verification.

## Dependency maintenance

The packager includes the reviewed Supabase client 2.117.3 and UUID 14.0.2 updates, plus Node type definitions 26.6.4 for development. Proxy support uses the reviewed `http-proxy-agent` and `https-proxy-agent` 9.1.0 dependencies. This release does not update the Azure Identity or MSAL dependencies.

## Upgrade notes

After the release is published, install the new version and restart the packager service:

```powershell
npm install -g @ugurkocde/intuneget-packager@1.4.2
intuneget-packager setup
```

Existing installations need the pinned toolkit ZIP once so the packager can verify extracted files. Packaging tool downloads during setup and the preliminary tool check before each job use PowerShell's existing download path when needed. They may require separate proxy configuration on a proxy only network, including for the first packaging job after an upgrade. Offline setup needs both the pinned executable and toolkit ZIP.

A rejected cache is preserved. Restore the pinned content or set `TOOLS_DIR` to a fresh directory and run setup again. Use a directory outside linked or synced parent folders because reparse points are refused. Old toolkit layouts may need a fresh tools directory. Failed extraction staging is retained with a warning and is never used as the toolkit.

## Compatibility and limitations

Windows remains required. This release does not add native Linux packaging, change QA profiles or pins, or claim that an application was installed on a customer device.

The stricter archive validation was covered with synthetic archives under PowerShell 5.1 and 7. Acceptance of the real upstream PSAppDeployToolkit 4.1.8 archive and a complete local packaging job remain to be verified. Integrity checks assume the installed packager code, manifest and tools directory are trusted.

The release contains the changes from #1561, #1566 and #1570.
