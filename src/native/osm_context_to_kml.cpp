#include <simdjson.h>

#include <array>
#include <charconv>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fs = std::filesystem;

namespace {

struct Point {
    double longitude{};
    double latitude{};
};

enum class Category : std::uint8_t {
    roads,
    county_borders,
    city_limits,
    landscape
};

struct Feature {
    Category category{};
    std::int64_t osm_id{};
    std::string osm_type;
    std::string name;
    std::string feature_class;
    std::string reference;
    std::vector<std::vector<Point>> lines;
    std::optional<Point> point;
};

std::string string_field(simdjson::dom::object object, std::string_view key) {
    auto result = object[key];
    if (result.error()) return {};
    std::string_view value;
    if (result.get(value)) return {};
    return std::string(value);
}

std::optional<double> number_field(simdjson::dom::object object, std::string_view key) {
    auto result = object[key];
    if (result.error()) return std::nullopt;
    double value{};
    if (result.get(value)) return std::nullopt;
    return value;
}

std::vector<Point> parse_geometry(simdjson::dom::element element) {
    simdjson::dom::array nodes;
    if (element.get(nodes)) return {};
    std::vector<Point> points;
    for (auto node_element : nodes) {
        simdjson::dom::object node;
        if (node_element.get(node)) continue;
        auto latitude = number_field(node, "lat");
        auto longitude = number_field(node, "lon");
        if (latitude && longitude) points.push_back({*longitude, *latitude});
    }
    return points;
}

std::optional<Point> direct_point(simdjson::dom::object object) {
    auto latitude = number_field(object, "lat");
    auto longitude = number_field(object, "lon");
    if (latitude && longitude) return Point{*longitude, *latitude};

    auto center_result = object["center"];
    if (center_result.error()) return std::nullopt;
    simdjson::dom::object center;
    if (center_result.get(center)) return std::nullopt;
    latitude = number_field(center, "lat");
    longitude = number_field(center, "lon");
    if (latitude && longitude) return Point{*longitude, *latitude};
    return std::nullopt;
}

std::optional<Point> centroid(const std::vector<std::vector<Point>>& lines) {
    double longitude{};
    double latitude{};
    std::size_t count{};
    for (const auto& line : lines) {
        for (const auto& point : line) {
            longitude += point.longitude;
            latitude += point.latitude;
            ++count;
        }
    }
    if (count == 0) return std::nullopt;
    return Point{longitude / static_cast<double>(count), latitude / static_cast<double>(count)};
}

Feature parse_feature(simdjson::dom::object object) {
    Feature feature;
    feature.osm_type = string_field(object, "type");
    auto id_result = object["id"];
    if (!id_result.error()) {
        const auto error = id_result.get(feature.osm_id);
        if (error) feature.osm_id = 0;
    }

    simdjson::dom::object tags;
    auto tags_result = object["tags"];
    if (!tags_result.error()) {
        const auto error = tags_result.get(tags);
        if (error) tags = {};
    }

    const std::string highway = string_field(tags, "highway");
    const std::string admin_level = string_field(tags, "admin_level");
    const std::string natural = string_field(tags, "natural");
    const std::string place = string_field(tags, "place");
    const std::string water = string_field(tags, "water");
    const std::string leisure = string_field(tags, "leisure");

    if (!highway.empty()) {
        feature.category = Category::roads;
        feature.feature_class = highway;
    } else if (admin_level == "6") {
        feature.category = Category::county_borders;
        feature.feature_class = "county";
    } else if (admin_level == "8") {
        feature.category = Category::city_limits;
        feature.feature_class = "city";
    } else {
        feature.category = Category::landscape;
        feature.feature_class = !natural.empty() ? natural : !place.empty() ? place : !water.empty() ? water : leisure;
    }

    feature.name = string_field(tags, "name");
    feature.reference = string_field(tags, "ref");
    if (feature.name.empty()) feature.name = !feature.reference.empty() ? feature.reference : feature.feature_class;

    auto geometry_result = object["geometry"];
    if (!geometry_result.error()) {
        auto line = parse_geometry(geometry_result.value());
        if (line.size() >= 2) feature.lines.push_back(std::move(line));
    }

    auto members_result = object["members"];
    if (!members_result.error()) {
        simdjson::dom::array members;
        if (!members_result.get(members)) {
            for (auto member_element : members) {
                simdjson::dom::object member;
                if (member_element.get(member)) continue;
                auto member_geometry = member["geometry"];
                if (member_geometry.error()) continue;
                auto line = parse_geometry(member_geometry.value());
                if (line.size() >= 2) feature.lines.push_back(std::move(line));
            }
        }
    }

    feature.point = direct_point(object);
    if (!feature.point && feature.category == Category::landscape) feature.point = centroid(feature.lines);
    return feature;
}

void append_xml(std::string& output, std::string_view value) {
    for (const char character : value) {
        switch (character) {
            case '&': output += "&amp;"; break;
            case '<': output += "&lt;"; break;
            case '>': output += "&gt;"; break;
            case '"': output += "&quot;"; break;
            case '\'': output += "&apos;"; break;
            default: output.push_back(character); break;
        }
    }
}

void append_double(std::string& output, double value) {
    std::array<char, 48> buffer{};
    const auto [end, error] = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value, std::chars_format::fixed, 7);
    if (error == std::errc{}) output.append(buffer.data(), end);
}

void append_extended_data(std::string& output, const Feature& feature) {
    output += "<ExtendedData>";
    const auto data = [&output](std::string_view name, std::string_view value) {
        output += "<Data name=\"";
        append_xml(output, name);
        output += "\"><value>";
        append_xml(output, value);
        output += "</value></Data>";
    };
    data("featureClass", feature.feature_class);
    data("osmType", feature.osm_type);
    if (!feature.reference.empty()) data("ref", feature.reference);
    output += "<Data name=\"osmId\"><value>" + std::to_string(feature.osm_id) + "</value></Data></ExtendedData>";
}

void append_line(std::string& output, const std::vector<Point>& line) {
    output += "<LineString><tessellate>1</tessellate><coordinates>";
    for (const auto& point : line) {
        append_double(output, point.longitude);
        output.push_back(',');
        append_double(output, point.latitude);
        output += ",0 ";
    }
    output += "</coordinates></LineString>";
}

void append_feature(std::string& output, const Feature& feature) {
    output += "<Placemark><name>";
    append_xml(output, feature.name);
    output += "</name>";
    append_extended_data(output, feature);

    if (feature.category == Category::landscape && feature.point) {
        output += "<Point><coordinates>";
        append_double(output, feature.point->longitude);
        output.push_back(',');
        append_double(output, feature.point->latitude);
        output += ",0</coordinates></Point>";
    } else if (feature.lines.size() == 1) {
        append_line(output, feature.lines.front());
    } else if (!feature.lines.empty()) {
        output += "<MultiGeometry>";
        for (const auto& line : feature.lines) append_line(output, line);
        output += "</MultiGeometry>";
    }
    output += "</Placemark>";
}

std::string_view category_name(Category category) {
    switch (category) {
        case Category::roads: return "roads";
        case Category::county_borders: return "county-borders";
        case Category::city_limits: return "city-limits";
        case Category::landscape: return "landscape-features";
    }
    return "unknown";
}

std::size_t category_index(Category category) {
    return static_cast<std::size_t>(category);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 3) {
        std::cerr << "Usage: osm-context-to-kml <overpass.json> <output-directory>\n";
        return 2;
    }

    simdjson::dom::parser parser;
    auto document_result = parser.load(argv[1]);
    if (document_result.error()) {
        std::cerr << "Failed to parse Overpass JSON: " << document_result.error() << '\n';
        return 1;
    }

    simdjson::dom::array elements;
    if (document_result.value()["elements"].get(elements)) {
        std::cerr << "Overpass response has no elements array\n";
        return 1;
    }

    std::array<std::string, 4> documents;
    std::array<std::size_t, 4> counts{};
    for (std::size_t index = 0; index < documents.size(); ++index) {
        const auto category = static_cast<Category>(index);
        documents[index] = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><kml xmlns=\"http://www.opengis.net/kml/2.2\"><Document><name>";
        documents[index] += category_name(category);
        documents[index] += "</name>";
        documents[index].reserve(512 * 1024);
    }

    for (auto element : elements) {
        simdjson::dom::object object;
        if (element.get(object)) continue;
        Feature feature = parse_feature(object);
        const bool valid = feature.category == Category::landscape ? feature.point.has_value() : !feature.lines.empty();
        if (!valid || feature.name.empty()) continue;
        const auto index = category_index(feature.category);
        append_feature(documents[index], feature);
        ++counts[index];
    }

    const fs::path output_directory = argv[2];
    fs::create_directories(output_directory);
    std::ofstream manifest(output_directory / "manifest.json", std::ios::binary);
    manifest << "{\n";
    for (std::size_t index = 0; index < documents.size(); ++index) {
        const auto category = static_cast<Category>(index);
        documents[index] += "</Document></kml>\n";
        const std::string name(category_name(category));
        std::ofstream output(output_directory / (name + ".kml"), std::ios::binary);
        output.write(documents[index].data(), static_cast<std::streamsize>(documents[index].size()));
        manifest << "  \"" << name << "\": " << counts[index] << (index + 1 == documents.size() ? "\n" : ",\n");
        std::cout << name << ": " << counts[index] << " features, " << documents[index].size() << " bytes\n";
    }
    manifest << "}\n";
}
