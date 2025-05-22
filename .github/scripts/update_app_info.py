#!/usr/bin/env python3
"""
Script to fetch app information from the Microsoft winget-pkgs repository
and update local JSON files with the latest information.
"""

import json
import os
import re
import sys
import yaml
import requests
from datetime import datetime
import time

# GitHub API base URL
GITHUB_API_BASE = "https://api.github.com"
GITHUB_RAW_BASE = "https://raw.githubusercontent.com"
WINGET_REPO = "microsoft/winget-pkgs"
WINGET_BRANCH = "master"

# Local paths
SUPPORTED_APPS_PATH = "supportedapps.json"
APPS_DIR = "Apps"

# Ensure Apps directory exists
os.makedirs(APPS_DIR, exist_ok=True)

# GitHub API rate limiting
MAX_RETRIES = 3
RETRY_DELAY = 10  # seconds


def check_github_token():
    """Check if a GitHub token is available and provide instructions if not."""
    if os.environ.get("GITHUB_TOKEN"):
        return True
    
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # In GitHub Actions, the token should be automatically available
        print("WARNING: GITHUB_TOKEN not found in GitHub Actions environment.")
        print("Make sure the workflow has permissions to access the token.")
        return False
    else:
        # For local development, provide instructions
        print("\n" + "="*80)
        print("No GitHub token found. To avoid rate limits, create a personal access token:")
        print("1. Go to https://github.com/settings/tokens")
        print("2. Click 'Generate new token' (classic)")
        print("3. Give it a name and select the 'public_repo' scope")
        print("4. Copy the token and set it as an environment variable:")
        print("   - Windows (CMD): set GITHUB_TOKEN=your_token_here")
        print("   - Windows (PowerShell): $env:GITHUB_TOKEN = 'your_token_here'")
        print("   - Linux/macOS: export GITHUB_TOKEN=your_token_here")
        print("="*80 + "\n")
        return False


def load_supported_apps():
    """Load the list of supported apps from the JSON file."""
    try:
        with open(SUPPORTED_APPS_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading supported apps: {e}")
        sys.exit(1)


def get_github_api(url, params=None):
    """Make a GitHub API request with retry logic for rate limiting."""
    headers = {}
    
    # Use GitHub token if available (for higher rate limits)
    github_token = os.environ.get("GITHUB_TOKEN")
    if github_token:
        headers["Authorization"] = f"token {github_token}"
        print("Using GitHub token for authentication")
    else:
        print("WARNING: No GitHub token found. API rate limits will be restricted.")
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, headers=headers, params=params)
            
            # Check if we hit rate limits
            if response.status_code == 403 and 'X-RateLimit-Remaining' in response.headers:
                remaining = int(response.headers.get('X-RateLimit-Remaining', 0))
                if remaining == 0:
                    reset_time = int(response.headers.get('X-RateLimit-Reset', 0))
                    current_time = time.time()
                    sleep_time = max(reset_time - current_time, 0) + 1
                    
                    # If we're in a GitHub Action, we can wait longer
                    if os.environ.get("GITHUB_ACTIONS") == "true":
                        print(f"Rate limit exceeded. Waiting until reset: {sleep_time:.0f} seconds...")
                        time.sleep(min(sleep_time, 60))  # Wait up to a minute in GitHub Actions
                    else:
                        # For local development, use a shorter delay
                        print(f"Rate limit exceeded. Would need to wait {sleep_time:.0f} seconds.")
                        print(f"Using shorter delay of {RETRY_DELAY} seconds for local development.")
                        time.sleep(RETRY_DELAY)
                    continue
            
            # Check for other errors
            if response.status_code != 200:
                print(f"GitHub API error: {response.status_code} - {response.text}")
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY * (attempt + 1)  # Exponential backoff
                    print(f"Retrying in {delay} seconds... (Attempt {attempt+1}/{MAX_RETRIES})")
                    time.sleep(delay)
                    continue
                else:
                    response.raise_for_status()
            
            # Success - return the JSON response
            return response.json()
            
        except requests.exceptions.RequestException as e:
            print(f"Request error: {e}")
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAY * (attempt + 1)
                print(f"Retrying in {delay} seconds... (Attempt {attempt+1}/{MAX_RETRIES})")
                time.sleep(delay)
            else:
                raise
    
    raise Exception("Failed to get GitHub API response after multiple retries")


def get_app_manifests(app_id):
    """Get the list of manifest folders for an app."""
    # Convert app ID to path format (e.g., "Discord.Discord" -> "d/Discord/Discord")
    first_letter = app_id[0].lower()
    parts = app_id.split('.')
    path = f"{first_letter}/{'/'.join(parts)}"
    
    # Get the contents of the app directory
    url = f"{GITHUB_API_BASE}/repos/{WINGET_REPO}/contents/manifests/{path}"
    try:
        contents = get_github_api(url)
        # Filter for version folders (should be directories)
        version_folders = [item for item in contents if item['type'] == 'dir']
        return version_folders
    except Exception as e:
        print(f"Error getting manifests for {app_id}: {e}")
        return []


def get_folder_commit_date(folder_url):
    """Get the latest commit date for a folder."""
    try:
        commits = get_github_api(f"{folder_url}?per_page=1")
        if commits and len(commits) > 0:
            commit_date = commits[0]['commit']['committer']['date']
            return datetime.strptime(commit_date, "%Y-%m-%dT%H:%M:%SZ")
        return datetime.min
    except Exception as e:
        print(f"Error getting commit date: {e}")
        return datetime.min


def is_version_folder(folder_name):
    """Check if a folder name starts with a number (likely a version folder)."""
    return re.match(r'^\d', folder_name) is not None


def get_latest_version_folder(app_id, folders):
    """Find the latest version folder by commit date."""
    # First filter for folders that start with a number (likely version folders)
    version_folders = [f for f in folders if is_version_folder(f['name'])]
    
    if not version_folders:
        print(f"No version folders found for {app_id}")
        return None
    
    print(f"Found {len(version_folders)} version folders for {app_id}")
    
    # To avoid excessive API calls, first try to sort by version number
    # This assumes semantic versioning or at least numeric versioning
    try:
        # Try to extract version numbers and sort them
        for folder in version_folders:
            # Extract numbers from the folder name
            version_str = re.search(r'(\d+(?:\.\d+)*)', folder['name'])
            if version_str:
                # Split by dots and convert to integers for proper numeric sorting
                version_parts = [int(part) for part in version_str.group(1).split('.')]
                folder['version_parts'] = version_parts
            else:
                folder['version_parts'] = [0]  # Default for folders without clear version numbers
        
        # Sort by version parts (highest version first)
        version_folders.sort(key=lambda x: x.get('version_parts', [0]), reverse=True)
        
        # Take the top 3 folders by version number to check commit dates
        # This reduces the number of API calls while still getting the latest
        top_folders = version_folders[:3]
        print(f"Checking commit dates for top {len(top_folders)} version folders")
    except Exception as e:
        print(f"Error sorting by version number: {e}")
        # If sorting by version fails, use all folders
        top_folders = version_folders
    
    # Get commit dates for the top folders
    for folder in top_folders:
        commits_url = f"{GITHUB_API_BASE}/repos/{WINGET_REPO}/commits"
        params = {
            'path': folder['path'],
            'per_page': 1
        }
        try:
            commits = get_github_api(commits_url, params)
            if commits and len(commits) > 0:
                commit_date = commits[0]['commit']['committer']['date']
                folder['commit_date'] = datetime.strptime(commit_date, "%Y-%m-%dT%H:%M:%SZ")
            else:
                folder['commit_date'] = datetime.min
        except Exception as e:
            print(f"Error getting commit date for {folder['name']}: {e}")
            folder['commit_date'] = datetime.min
    
    # Sort by commit date (newest first)
    top_folders.sort(key=lambda x: x.get('commit_date', datetime.min), reverse=True)
    
    if top_folders:
        latest = top_folders[0]
        print(f"Latest version folder for {app_id}: {latest['name']} (committed on {latest.get('commit_date')})")
        return latest
    
    return None


def get_installer_yaml(app_id, version_folder):
    """Get the installer YAML file from a version folder."""
    folder_path = version_folder['path']
    installer_file = f"{app_id}.installer.yaml"
    yaml_url = f"{GITHUB_RAW_BASE}/{WINGET_REPO}/{WINGET_BRANCH}/{folder_path}/{installer_file}"
    
    # Add retry logic for network issues
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(yaml_url)
            if response.status_code == 200:
                try:
                    return yaml.safe_load(response.text)
                except yaml.YAMLError as e:
                    print(f"Error parsing YAML content: {e}")
                    return None
            else:
                print(f"Error getting installer YAML: {response.status_code}")
                
                # If file not found, try alternative filenames
                if response.status_code == 404:
                    # Some packages use different naming conventions
                    alt_installer_files = [
                        f"{app_id}.yaml",  # Some packages use a single YAML file
                        f"{app_id}.Installer.yaml"  # Different capitalization
                    ]
                    
                    for alt_file in alt_installer_files:
                        alt_url = f"{GITHUB_RAW_BASE}/{WINGET_REPO}/{WINGET_BRANCH}/{folder_path}/{alt_file}"
                        print(f"Trying alternative file: {alt_file}")
                        try:
                            alt_response = requests.get(alt_url)
                            if alt_response.status_code == 200:
                                return yaml.safe_load(alt_response.text)
                        except Exception:
                            continue
                
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY * (attempt + 1)
                    print(f"Retrying in {delay} seconds... (Attempt {attempt+1}/{MAX_RETRIES})")
                    time.sleep(delay)
                else:
                    return None
        except requests.exceptions.RequestException as e:
            print(f"Network error getting installer YAML: {e}")
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAY * (attempt + 1)
                print(f"Retrying in {delay} seconds... (Attempt {attempt+1}/{MAX_RETRIES})")
                time.sleep(delay)
            else:
                return None
    
    return None


def save_app_info(app_id, app_name, installer_data, architecture):
    """Save app information to a JSON file."""
    # Extract the installer for the specified architecture
    installer = None
    for inst in installer_data.get('Installers', []):
        if inst.get('Architecture') == architecture:
            installer = inst
            break
    
    if not installer:
        print(f"No installer found for {app_id} with architecture {architecture}")
        return False
    
    # Create the JSON data
    json_data = {
        "PackageIdentifier": installer_data.get('PackageIdentifier'),
        "PackageVersion": installer_data.get('PackageVersion'),
        "InstallerType": installer_data.get('InstallerType'),
        "Scope": installer_data.get('Scope'),
        "InstallModes": installer_data.get('InstallModes', []),
        "InstallerSwitches": installer_data.get('InstallerSwitches', {}),
        "InstallerUrl": installer.get('InstallerUrl'),
        "InstallerSha256": installer.get('InstallerSha256'),
        "Architecture": architecture
    }
    
    # Remove None values
    json_data = {k: v for k, v in json_data.items() if v is not None}
    
    # Create filename based on app name and architecture
    app_name_clean = app_name.lower().replace(' ', '_')
    filename = f"{app_name_clean}_{architecture.lower()}.json"
    file_path = os.path.join(APPS_DIR, filename)
    
    # Check if file exists and compare versions
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r') as f:
                existing_data = json.load(f)
                existing_version = existing_data.get('PackageVersion')
                new_version = json_data.get('PackageVersion')
                
                if existing_version and new_version:
                    # Compare versions using semantic versioning if possible
                    try:
                        # First, normalize versions by ensuring they have at least 3 components
                        def normalize_version(version_str):
                            # Extract numbers from version string
                            version_parts = re.findall(r'\d+', version_str)
                            # Ensure at least 3 components (major.minor.patch)
                            while len(version_parts) < 3:
                                version_parts.append('0')
                            # Convert to integers for comparison
                            return [int(part) for part in version_parts]
                        
                        existing_parts = normalize_version(existing_version)
                        new_parts = normalize_version(new_version)
                        
                        # Compare version components
                        is_newer = False
                        for i in range(max(len(existing_parts), len(new_parts))):
                            existing_part = existing_parts[i] if i < len(existing_parts) else 0
                            new_part = new_parts[i] if i < len(new_parts) else 0
                            
                            if new_part > existing_part:
                                is_newer = True
                                break
                            elif new_part < existing_part:
                                is_newer = False
                                break
                        
                        if not is_newer:
                            print(f"Existing version {existing_version} is newer or same as {new_version}. Skipping update.")
                            return False
                    except Exception as e:
                        # Fallback to string comparison if semantic versioning fails
                        print(f"Error in semantic version comparison: {e}")
                        if existing_version >= new_version:
                            print(f"Existing version {existing_version} is newer or same as {new_version} (string comparison). Skipping update.")
                            return False
        except Exception as e:
            print(f"Error reading existing file {file_path}: {e}")
    
    # Write the new data
    try:
        with open(file_path, 'w') as f:
            json.dump(json_data, f, indent=2)
        print(f"Updated {file_path} with version {json_data.get('PackageVersion')}")
        return True
    except Exception as e:
        print(f"Error writing to {file_path}: {e}")
        return False


def process_app(app):
    """Process a single app and update its information."""
    app_id = app.get('id')
    app_name = app.get('name')
    
    if not app_id or not app_name:
        print("Invalid app entry: missing id or name")
        return False
    
    print(f"\nProcessing {app_name} ({app_id})...")
    
    # Get manifest folders
    folders = get_app_manifests(app_id)
    if not folders:
        print(f"No manifest folders found for {app_id}")
        return False
    
    # Get the latest version folder
    latest_folder = get_latest_version_folder(app_id, folders)
    if not latest_folder:
        return False
    
    # Get the installer YAML
    installer_data = get_installer_yaml(app_id, latest_folder)
    if not installer_data:
        return False
    
    # Process each architecture
    updated = False
    architectures = set(inst.get('Architecture') for inst in installer_data.get('Installers', []))
    
    for arch in architectures:
        if save_app_info(app_id, app_name, installer_data, arch):
            updated = True
    
    return updated


def main():
    """Main function to update app information."""
    print(f"Starting app information update at {datetime.now().isoformat()}")
    
    # Check for GitHub token
    check_github_token()
    
    # Load supported apps
    apps = load_supported_apps()
    print(f"Loaded {len(apps)} apps from {SUPPORTED_APPS_PATH}")
    
    # Process each app
    updated_count = 0
    for app in apps:
        if process_app(app):
            updated_count += 1
    
    print(f"\nUpdate completed. Updated information for {updated_count} apps.")


if __name__ == "__main__":
    main()