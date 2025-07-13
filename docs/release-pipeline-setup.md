# Release Pipeline Setup Guide

This guide covers setting up automated releases for the Jeffers Electron application using GitHub Actions.

The release pipeline automatically builds and signs the application for macOS, Windows, and Linux when you create a Git tag. The built applications are automatically uploaded to GitHub Releases and distributed to users via the built-in auto-updater.

## Required GitHub Secrets (9 total)

Configure these secrets in your GitHub repository settings (`Settings > Secrets and variables > Actions`):

**Repository Configuration**
- `GITHUB_REPOSITORY_OWNER` - Your GitHub username
- `GITHUB_REPOSITORY_NAME` - Repository name (e.g., "jeffers")

**Apple Developer Requirements**
- `APPLE_TEAM_ID` - 10-character alphanumeric from Apple Developer Portal (e.g., "ABC123DEF4")
- `APPLE_ID` - Your Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD` - Generate at appleid.apple.com → App-Specific Passwords
- `APPLE_CERTIFICATE` - "Developer ID Application" certificate from Keychain Access (export as .p12, then base64 encode)
- `APPLE_CERTIFICATE_PASSWORD` - Password you set when exporting .p12
- `APPLE_KEYCHAIN_PASSWORD` - Any secure password for CI keychain

**Windows Code Signing**
- `WINDOWS_CERTIFICATE` - Code signing certificate from CA like DigiCert/Sectigo (.p12 file, base64 encoded)  
- `WINDOWS_CERTIFICATE_PASSWORD` - Certificate password

Note: Windows certificates must be from a trusted Certificate Authority. Self-signed certificates won't work for distribution.

## Setup Instructions

**Getting your Apple certificates:**
1. Apple Developer portal → Certificates → Create "Developer ID Application" 
2. Download as `.cer`, import to Keychain Access, export as `.p12`
3. Convert to base64: `base64 -i certificate.p12 | pbcopy`

**Getting your Windows certificate:**
1. Purchase from trusted CA (DigiCert, Sectigo, etc.)
2. Convert to base64: `base64 -i certificate.p12 | pbcopy`

## How It Works

**Triggering a release:**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**What happens automatically:**
- Builds for macOS (x64/ARM64), Windows, Linux
- Code signs and notarizes (if certificates configured)
- Creates GitHub Release with downloadable assets
- Users get auto-update notifications

**Release types:** `v1.0.0` (production), `v1.0.0-beta.1` (beta), `v1.0.0-alpha.1` (testing)


## Testing First

Start with a beta release to test everything works:
```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

Download the builds from GitHub Releases and verify:
- No security warnings (means code signing worked)
- Auto-update notifications appear correctly

## Manual Fallback

If GitHub Actions is down, you can build locally:
```bash
export GITHUB_REPOSITORY_OWNER=your-username
export GITHUB_REPOSITORY_NAME=jeffers
npm run build:all && npm run package
```

## Notes

- **Costs**: Free for public repos, ~30-45 minutes per release for private repos
- **Security**: Certificates are base64-encoded in secrets, never exposed in logs
- **Support**: Check GitHub Actions workflow logs for detailed error messages