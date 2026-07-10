# Packaging Workflow Reference

This is a reference copy of the packaging workflow.
The actual workflow runs in a private repository to protect user tenant information.

For self-hosting, see [SELF_HOSTING.md](/docs/SELF_HOSTING.md) to run your own packager.

## Production requirements

The private copy must keep the public `IntuneGet` checkout pinned to a reviewed
commit SHA. Before deploying this version:

1. Configure the repository variable `CALLBACK_ALLOWED_ORIGIN` with the exact
   HTTPS origin used by the IntuneGet callback API.
2. Configure `AZURE_CLIENT_ID` as a repository variable and add a GitHub Actions
   federated identity credential to the Entra application. A client secret is
   no longer used.
3. Send `hashValidationMode: strict` and a trusted 64-character installer
   SHA-256 in every dispatch. Missing hashes and mismatches are rejected.
4. Update the pinned public commit only after reviewing changes to
   `.github/scripts/Create-PSADTPackage.ps1` and
   `.github/scripts/Check-DuplicateApp.ps1`.

The workflow serializes deployments for the same tenant and WinGet ID to avoid
duplicate-creation races. Requested relationship failures are terminal and are
reported as partial deployment failures instead of silent success.
