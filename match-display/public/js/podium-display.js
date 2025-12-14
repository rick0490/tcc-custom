/**
 * Podium Display for Match Display
 *
 * Renders the tournament results podium view (1st, 2nd, 3rd place).
 * Extracted from MMM-TournamentNowPlaying.js
 */

class PodiumDisplay {
    constructor() {
        this.debugMode = false;
    }

    /**
     * Enable/disable debug logging
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Log message if debug mode is enabled
     */
    log(action, data = {}) {
        if (this.debugMode) {
            console.log(`%c[PodiumDisplay] ${action}`, 'color: #fbbf24', data);
        }
    }

    /**
     * Create podium row box
     * @param {string} label - Place label (1st Place, 2nd Place, etc.)
     * @param {string} name - Player name
     * @param {string} color - Medal color (gold, silver, bronze)
     * @returns {HTMLElement} Podium box element
     */
    createPodiumRow(label, name, color) {
        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.alignItems = 'center';
        box.style.justifyContent = 'center';
        box.style.flexDirection = 'column';
        box.style.margin = '15px 0';
        box.style.borderRadius = '12px';
        box.style.boxSizing = 'border-box';
        box.style.padding = '30px 30px';
        box.style.background = '#000000';

        // Colored borders for podium places
        if (color === 'gold') {
            box.style.border = '6px solid #FFD700';
            box.style.boxShadow = '0 0 30px rgba(255, 215, 0, 0.4)';
        } else if (color === 'silver') {
            box.style.border = '5px solid #C0C0C0';
            box.style.boxShadow = '0 0 25px rgba(192, 192, 192, 0.3)';
        } else if (color === 'bronze') {
            box.style.border = '4px solid #CD7F32';
            box.style.boxShadow = '0 0 20px rgba(205, 127, 50, 0.3)';
        }

        const labelDiv = document.createElement('div');
        labelDiv.innerHTML = label;
        labelDiv.style.fontSize = '52px';
        labelDiv.style.marginBottom = '15px';
        labelDiv.style.fontWeight = '900';
        labelDiv.style.textTransform = 'uppercase';
        labelDiv.style.letterSpacing = '4px';
        labelDiv.style.color = '#ff2e2e';
        box.appendChild(labelDiv);

        const nameDiv = document.createElement('div');
        nameDiv.innerHTML = name;
        nameDiv.style.fontSize = '64px';
        nameDiv.style.fontWeight = '900';
        nameDiv.style.textAlign = 'center';
        nameDiv.style.color = '#ffffff';
        nameDiv.style.lineHeight = '1.3';
        box.appendChild(nameDiv);

        return box;
    }

    /**
     * Render the podium display
     * @param {Object} podium - Podium data
     * @param {string} podium.first - First place name
     * @param {string} podium.second - Second place name
     * @param {string} podium.third - Third place name
     * @param {boolean} podium.has3rdPlace - Whether tournament has 3rd place match
     * @returns {HTMLElement} Podium wrapper element
     */
    render(podium) {
        this.log('render', podium);

        const p = podium || {
            first: null,
            second: null,
            third: null,
            has3rdPlace: false
        };

        const firstName = p.first || 'TBD';
        const secondName = p.second || 'TBD';
        const thirdName = p.third || 'TBD';
        const has3rdPlace = p.has3rdPlace || false;

        const wrapper = document.createElement('div');
        wrapper.className = 'tourney-podium';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
        wrapper.style.color = 'white';
        wrapper.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        wrapper.style.boxSizing = 'border-box';
        wrapper.style.padding = '30px 40px';
        wrapper.style.backgroundColor = 'black';

        // Header (Tournament Results) ~10%
        const header = document.createElement('div');
        header.innerHTML = 'Tournament Results';
        header.style.flex = '0 0 12%';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'center';
        header.style.fontSize = '72px';
        header.style.fontWeight = '900';
        header.style.textTransform = 'uppercase';
        header.style.letterSpacing = '6px';
        header.style.textAlign = 'center';
        header.style.color = '#ff2e2e';
        header.style.borderBottom = '6px solid #ff2e2e';
        header.style.paddingBottom = '20px';
        wrapper.appendChild(header);

        // Adjust sizing based on whether tournament has 3rd place match
        const firstHeight = has3rdPlace ? '50%' : '60%';
        const secondHeight = has3rdPlace ? '25%' : '28%';

        // 1st place row
        const firstRow = document.createElement('div');
        firstRow.style.flex = '0 0 ' + firstHeight;
        firstRow.style.display = 'flex';
        firstRow.style.alignItems = 'center';
        firstRow.style.justifyContent = 'center';
        firstRow.style.padding = '10px 0';

        const firstBox = this.createPodiumRow('1st Place', firstName, 'gold');
        firstBox.style.width = '80%';
        firstRow.appendChild(firstBox);

        // 2nd place row
        const secondRow = document.createElement('div');
        secondRow.style.flex = '0 0 ' + secondHeight;
        secondRow.style.display = 'flex';
        secondRow.style.alignItems = 'center';
        secondRow.style.justifyContent = 'center';
        secondRow.style.padding = '8px 0';

        const secondBox = this.createPodiumRow('2nd Place', secondName, 'silver');
        secondBox.style.width = '70%';
        secondRow.appendChild(secondBox);

        wrapper.appendChild(firstRow);
        wrapper.appendChild(secondRow);

        // Only show 3rd place row if tournament has a 3rd place match
        if (has3rdPlace) {
            // 3rd place row ~15% height
            const thirdRow = document.createElement('div');
            thirdRow.style.flex = '0 0 15%';
            thirdRow.style.display = 'flex';
            thirdRow.style.alignItems = 'center';
            thirdRow.style.justifyContent = 'center';
            thirdRow.style.padding = '6px 0';

            const thirdBox = this.createPodiumRow('3rd Place', thirdName, 'bronze');
            thirdBox.style.width = '60%';
            thirdRow.appendChild(thirdBox);

            wrapper.appendChild(thirdRow);
        }

        return wrapper;
    }

    /**
     * Check if podium data is complete
     * @param {Object} podium - Podium data
     * @returns {boolean} Whether podium data is complete
     */
    isComplete(podium) {
        return podium && podium.isComplete === true;
    }
}

// Export for use in other modules
window.PodiumDisplay = PodiumDisplay;
