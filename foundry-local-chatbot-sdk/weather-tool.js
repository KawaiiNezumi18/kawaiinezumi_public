// This file defines one AI tool: get_weather.
// The model sees the schema below and decides when to call it.
// When the model calls it, the handler runs the real logic to fetch weather data.

// Base URLs for external APIs: one for geocoding (city → lat/long),
// and one for weather forecasts (lat/long → weather data).
const GEOCODING_API_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast';

// Tool definition that the AI model reads.
// It describes the function name, purpose, and expected parameters.
export const weatherTool = {
    schema: {
        type: 'function',
        function: {
            name: 'get_weather',    // Function name exposed to the model
            description: 'Get the current weather for a city or location',
            parameters: {
                type: 'object',
                properties: {
                    location: { // City or location name
                        type: 'string',
                        description: 'The city or location to look up'
                    },
                    unit: { // Temperature unit
                        type: 'string',
                        enum: ['celsius', 'fahrenheit'],
                        description: 'Temperature unit for the response'
                    }
                },
                required: ['location', 'unit'], // Both must be provided
                additionalProperties: false
            }
        }
    },
    // Handler function that the model actually calls.
    // It extracts arguments and passes them to getWeather().
    handler: async (args = {}) => {
        const { location, unit = 'celsius' } = args;
        return getWeather(location, unit);
    }
};

// Mapping of Open-Meteo weather codes to human-readable descriptions.
const weatherDescriptions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail'
};

// Helper function to fetch JSON from a URL.
// Throws an error if the response is not successful.
async function fetchJson(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Weather service returned HTTP ${response.status}.`);
    }

    return response.json();
}

// Core weather logic:
// 1. Validate input
// 2. Convert city name → latitude/longitude (via geocoding API)
// 3. Fetch current weather data for that location
// 4. Return a clean, readable result object
async function getWeather(location, unit = 'celsius') {
    // Normalize inputs (trim strings, default to celsius)
    const normalizedLocation = typeof location === 'string'
        ? location.trim()
        : '';
    const normalizedUnit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';

    console.log('getWeather called:', { location, unit });

    // If no location provided, return an error
    if (!normalizedLocation) {
        const result = { error: 'A location is required.' };
        console.log('getWeather returned:', result);
        return result;
    }

    // Build geocoding API request
    const geocodingUrl = new URL(GEOCODING_API_URL);
    geocodingUrl.search = new URLSearchParams({
        name: normalizedLocation,
        count: '1', // Only return the first match
        language: 'en',
        format: 'json'
    });

    // Call geocoding API
    const geocoding = await fetchJson(geocodingUrl);
    const result = geocoding.results?.[0];

    // If no match found, return error
    if (!result) {
        const response = {
            error: `Could not find a location named "${normalizedLocation}".`
        };
        console.log('getWeather returned:', response);
        return response;
    }

    // Build weather API request using lat/long from geocoding
    const weatherUrl = new URL(WEATHER_API_URL);
    weatherUrl.search = new URLSearchParams({
        latitude: String(result.latitude),
        longitude: String(result.longitude),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
        temperature_unit: normalizedUnit,
        wind_speed_unit: normalizedUnit === 'fahrenheit' ? 'mph' : 'kmh',
        timezone: 'auto'
    });

    // Call weather API
    const weather = await fetchJson(weatherUrl);
    const current = weather.current;
    const currentUnits = weather.current_units;

    // Construct final response object
    const response = {
        location: [result.name, result.admin1, result.country]
            .filter(Boolean)
            .join(', '),
        temperature: current.temperature_2m,
        temperatureUnit: currentUnits.temperature_2m,
        feelsLike: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        windSpeedUnit: currentUnits.wind_speed_10m,
        condition: weatherDescriptions[current.weather_code] || 'Unknown',
        observedAt: current.time
    };

    console.log('getWeather returned:', response);
    
    return response;
}