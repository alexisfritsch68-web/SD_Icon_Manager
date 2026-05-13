# SD Icon Manager

A desktop application for creating custom icon packs for your Steam Deck games using the SteamGridDB database.

## 📋 Project Overview

SD Icon Manager is a Tauri-based icon pack creator that allows users to browse, search, and compile custom icon
collections for their Steam Deck game library. The application integrates with SteamGridDB's extensive icon database to
help you build and organize personalized icon packs.

## ✨ Features

- **Icon Pack Creation**: Create and manage custom icon packs for your game library
- **Icon Search & Browse**: Search and browse through thousands of game icons from SteamGridDB
- **Pack Organization**: Organize and categorize icons into themed packs
- **Batch Operations**: Add multiple icons to your pack in one go
- **Export Functionality**: Export your icon packs for easy sharing and installation
- **High Quality Icons**: Access to high-resolution icons from SteamGridDB's CDN
- **Modern UI**: Clean, responsive interface optimized for Steam Deck (1300x850)

## 🛠️ Technical Stack

- **Frontend**: Custom UI built with web technologies
- **Backend**: Rust-based Tauri framework (v2.11.1)
- **Image Processing**: Image manipulation and optimization for icon formats
- **Network**: HTTP client for SteamGridDB API integration
- **Packaging**: Cross-platform builds with Tauri

### Key Dependencies

- Tauri 2.11.1 - Application framework
- reqwest 0.12.28 - HTTP client for API calls
- image 0.25.10 - Icon processing and optimization
- serde/serde_json - Data serialization for pack metadata
- tauri-plugin-dialog - File system operations for pack import/export

## 📦 Current State

**Version**: 0.1.0 (Alpha)

This project is in early development stage. Core functionality is being implemented:

- ✅ SteamGridDB icon API integration
- ✅ Icon downloading and caching
- ✅ Basic UI framework
- 🚧 Icon pack creation and management
- 🚧 Pack export and sharing
- 🚧 Advanced search and filtering

## 🎯 Use Cases

- Create themed icon packs (e.g., minimalist, retro, neon)
- Build complete library icon sets
- Share custom icon collections with the community
- Maintain consistent visual style across your game library
- Quick icon replacement for new games

## 🚀 Getting Started

### Prerequisites

- Rust 1.92.0 or higher
- Node.js (for frontend development)
- Tauri CLI

### Installation
