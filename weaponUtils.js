const fs = require('fs');
const path = require('path');

let WEAPON_DATA = {};

async function loadWeaponData() {
    try {
        const dataPath = path.join(__dirname, 'public', 'resources', 'data', 'weapon_data.json');
        const data = await fs.promises.readFile(dataPath, 'utf8');
        WEAPON_DATA = JSON.parse(data);
        console.log('Server: Weapon data loaded successfully.');
    } catch (error) {
        console.error('Server: Failed to load weapon data:', error);
    }
}

function getRandomWeaponName() {
    const weaponNames = Object.keys(WEAPON_DATA).filter(name => {
        // Potion과 원거리 무기(type: "ranged") 제외
        if (name === 'Potion1_Filled.fbx') return false;
        const weaponData = WEAPON_DATA[name];
        if (weaponData && weaponData.type === 'ranged') return false;
        return true;
    });
    if (weaponNames.length === 0) {
        console.warn("Server: No weapons available to spawn (excluding Potion and ranged weapons).");
        return null;
    }
    const randomIndex = Math.floor(Math.random() * weaponNames.length);
    return weaponNames[randomIndex];
}

// Load weapon data when the module is first loaded
loadWeaponData();

module.exports = {
    WEAPON_DATA,
    loadWeaponData, // Export for potential re-loading if needed
    getRandomWeaponName
};
